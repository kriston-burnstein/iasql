import format from 'pg-format';
import { EntityMetadata, In, MoreThan } from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import { RelationMetadata } from 'typeorm/metadata/RelationMetadata';
import { snakeCase } from 'typeorm/util/StringUtils';

import { IasqlFunctions } from '..';
import { RpcInput } from '../../../modules';
import { getCloudId } from '../../../services/cloud-id';
import logger from '../../../services/logger';
import { TypeormWrapper } from '../../../services/typeorm';
import { AuditLogChangeType, IasqlAuditLog } from '../../iasql_platform/entity';
import {
  Context,
  MapperBase,
  ModuleInterface,
  PostTransactionCheck,
  PreTransactionCheck,
  RpcBase,
  RpcResponseObject,
} from '../../interfaces';
import { getInstalledModules } from '../iasql';
import { indexModsByTable } from '../iasql';

/**
 * Method that generates SQL from the audit log from a given point in time.
 *
 *
 */
export class IasqlGetSqlSince extends RpcBase {
  /** @internal */
  module: IasqlFunctions;
  /** @internal */
  preTransactionCheck = PreTransactionCheck.NO_CHECK;
  /** @internal */
  postTransactionCheck = PostTransactionCheck.NO_CHECK;
  /** @internal */
  inputTable: RpcInput = {
    limitDate: { argType: 'varchar', default: null, rawDefault: true },
  };
  /** @internal */
  outputTable = {
    sql: 'varchar',
  } as const;

  documentation = {
    description: 'Generate SQL from the audit log from a given point in time',
    sampleUsage: "SELECT * FROM iasql_get_sql_since((now() - interval '30 minutes')::text)",
  };

  /** @internal */
  call = async (
    _dbId: string,
    _dbUser: string,
    ctx: Context,
    limitDate: string,
  ): Promise<RpcResponseObject<typeof this.outputTable>[]> => {
    let queries: string[];
    try {
      const changeLogs = await getChangeLogs(limitDate, ctx.orm);
      const installedModules = await getInstalledModules(ctx.orm);
      const modsIndexedByTable = indexModsByTable(installedModules);
      queries = await recreateQueries(changeLogs, modsIndexedByTable, ctx.orm);
    } catch (e) {
      throw e;
    }
    return (queries ?? []).map(q => ({ sql: q }));
  };

  constructor(module: IasqlFunctions) {
    super();
    this.module = module;
    super.init();
  }
}

/**
 * @internal
 * Returns the relevant `IasqlAuditLog`s order by timestamp with older logs first.
 */
async function getChangeLogs(limitDate: string, orm: TypeormWrapper): Promise<IasqlAuditLog[]> {
  const whereClause: any = {
    changeType: In([AuditLogChangeType.INSERT, AuditLogChangeType.UPDATE, AuditLogChangeType.DELETE]),
  };
  if (limitDate) {
    // `try_cast` will try to return the `limitDate` casted as `timestamp with time zone` or `null`if the cast fails
    const castRes = await orm.query(`SELECT try_cast('${limitDate}', NULL::timestamp with time zone);`);
    const castedValue = castRes?.pop()?.try_cast;
    if (castedValue === undefined || castedValue === null) {
      throw new Error(`Cannot cast ${limitDate} to timestamp with time zone`);
    }
    whereClause.ts = MoreThan(new Date(castedValue));
  }
  return orm.find(IasqlAuditLog, {
    order: { ts: 'ASC', id: 'ASC' },
    where: whereClause,
  });
}

/**
 * @internal
 * Returns the queries recreated from the change logs.
 */
async function recreateQueries(
  changeLogs: IasqlAuditLog[],
  modsIndexedByTable: { [key: string]: ModuleInterface },
  orm: TypeormWrapper,
): Promise<string[]> {
  const queries: string[] = [];
  for (const cl of changeLogs) {
    let query: string = '';
    switch (cl.changeType) {
      case AuditLogChangeType.INSERT:
        const insertedEntries = Object.entries(cl.change?.change ?? {}).filter(
          ([k, v]: [string, any]) => k !== 'id' && v !== null,
        );
        const valuesToInsert = await Promise.all(
          insertedEntries.map(
            async ([k, v]: [string, any]) =>
              await findRelationOrReturnFormattedValue(cl.tableName, k, v, modsIndexedByTable, orm),
          ),
        );
        query = format(
          `
          INSERT INTO %I (${insertedEntries.map(_ => '%I').join(', ')})
          VALUES (${insertedEntries.map(_ => '%s').join(', ')});
        `,
          cl.tableName,
          ...insertedEntries.map(([k, _]: [string, any]) => k),
          ...valuesToInsert,
        );
        break;
      case AuditLogChangeType.DELETE:
        const relevantEntries = Object.entries(cl.change?.original ?? {}).filter(
          ([k, v]: [string, any]) => k !== 'id' && v !== null,
        );
        const valuesDeleted = await Promise.all(
          relevantEntries.map(
            async ([k, v]: [string, any]) =>
              await findRelationOrReturnFormattedValue(cl.tableName, k, v, modsIndexedByTable, orm),
          ),
        );
        query = format(
          `
            DELETE FROM %I
            WHERE ${relevantEntries
              .map(
                ([_, v]: [string, any]) =>
                  `${typeof v === 'object' && !Array.isArray(v) ? '%I::jsonb = %s' : '%I = %s'}`,
              )
              .join(' AND ')};
          `,
          cl.tableName,
          ...relevantEntries.flatMap(([k, _]: [string, any], i) => [k, valuesDeleted[i]]),
        );
        break;
      case AuditLogChangeType.UPDATE:
        const originalEntries = Object.entries(cl.change?.original ?? {})
          // We need to add an special case for AMIs since we know the revolve string can be used and it will not match with the actual AMI assigned
          .filter(([k, _]: [string, any]) => k !== 'ami' && k !== 'id');
        const updatedEntries = Object.entries(cl.change?.change ?? {}).filter(
          ([k, _]: [string, any]) => k !== 'id',
        );
        const updatedValues = await Promise.all(
          updatedEntries.map(
            async ([k, v]: [string, any]) =>
              await findRelationOrReturnFormattedValue(cl.tableName, k, v, modsIndexedByTable, orm),
          ),
        );
        const oldValues = await Promise.all(
          originalEntries.map(
            async ([k, v]: [string, any]) =>
              await findRelationOrReturnFormattedValue(cl.tableName, k, v, modsIndexedByTable, orm),
          ),
        );
        query = format(
          `
          UPDATE %I
          SET ${updatedEntries
            .map(
              ([_, v]: [string, any]) =>
                `${typeof v === 'object' && !Array.isArray(v) ? '%I::jsonb = %s' : '%I = %s'}`,
            )
            .join(', ')}
          WHERE ${originalEntries
            .map(
              ([_, v]: [string, any]) =>
                `${typeof v === 'object' && !Array.isArray(v) ? '%I::jsonb = %s' : '%I = %s'}`,
            )
            .join(' AND ')};
        `,
          cl.tableName,
          ...updatedEntries.flatMap(([k, _]: [string, any], i) => [k, updatedValues[i]]),
          ...originalEntries.flatMap(([k, _]: [string, any], i) => [k, oldValues[i]]),
        );
        break;
      default:
        break;
    }
    if (query) queries.push(query);
  }
  return queries;
}

/**
 * @internal
 * The changes from iasql_audit_log are stored as JSON.
 * We need to look if the value is a relation to other table and return the respective sub-query
 * or return a formatted value for the query.
 */
async function findRelationOrReturnFormattedValue(
  tableName: string,
  key: string,
  value: any,
  modsIndexedByTable: { [key: string]: ModuleInterface },
  orm: TypeormWrapper,
): Promise<string> {
  // We might need to recreate a sub-query because it could be column referencing other table.
  // For this we need to get Typeorm metadata for the `tableName` and inspect the columns and relations in order to recreate the sub-query if necessary.
  // We need to recreate the sub-query because related columns might not be the same across databases connected to the same cloud account.
  const metadata = await getMetadata(tableName, modsIndexedByTable, orm);
  let columnMetadata: ColumnMetadata | undefined;
  if (value && metadata) {
    // If `metadata instanceof EntityMetadata` means that there's an Entity in Typeorm which it's table name is `tableName`
    if (metadata instanceof EntityMetadata) {
      columnMetadata = metadata.ownColumns.filter(oc => oc.databaseName === key)?.pop();
      if (!!columnMetadata?.relationMetadata) {
        return await recreateSubQuery(
          columnMetadata.referencedColumn?.databaseName ?? 'unknown_key',
          value,
          columnMetadata.relationMetadata?.inverseEntityMetadata,
          modsIndexedByTable,
          orm,
        );
      }
    }
    // If `metadata instanceof RelationMetadata` means that there's no Entity in Typeorm which it's table name is `tableName`,
    // but theres a join table linking entities and `tableName` is that join table. In this case we need to check `joinColumns`
    // which will have the columns from the owner of the relationship and `inverseJoinColumns` will have the columns coming from
    // the other entities in the relationship.
    if (metadata instanceof RelationMetadata) {
      columnMetadata = metadata.joinColumns.filter(jc => jc.databaseName === key)?.pop();
      if (!!columnMetadata?.relationMetadata) {
        return await recreateSubQuery(
          columnMetadata.referencedColumn?.databaseName ?? 'unknown_key',
          value,
          columnMetadata.relationMetadata?.entityMetadata,
          modsIndexedByTable,
          orm,
        );
      }
      columnMetadata = metadata.inverseJoinColumns.filter(jc => jc.databaseName === key)?.pop();
      if (!!columnMetadata?.relationMetadata) {
        return await recreateSubQuery(
          columnMetadata.referencedColumn?.databaseName ?? 'unknown_key',
          value,
          columnMetadata.relationMetadata?.inverseEntityMetadata,
          modsIndexedByTable,
          orm,
        );
      }
    }
  }
  // Arrays have special behaviour in postgres. We try to cast the right array type when possible.
  if (columnMetadata && columnMetadata.isArray) {
    return typeof columnMetadata.type === 'string'
      ? format('array[%L]::%I[]', value, columnMetadata.type)
      : format('array[%L]', value);
  } else if (typeof value === 'object' && Array.isArray(value)) {
    return typeof columnMetadata?.type === 'string'
      ? format('%L::%I', JSON.stringify(value), columnMetadata.type)
      : format('%L', JSON.stringify(value));
  }
  return format('%L', value);
}

/**
 * @internal
 * Returns Typeorm metadata related to `tableName`
 */
async function getMetadata(
  tableName: string,
  modsIndexedByTable: { [key: string]: ModuleInterface },
  orm: TypeormWrapper,
): Promise<EntityMetadata | RelationMetadata | undefined> {
  const mappers = Object.values(modsIndexedByTable[tableName] ?? {}).filter(val => val instanceof MapperBase);
  let metadata: EntityMetadata | RelationMetadata | undefined;
  for (const m of mappers) {
    const tableEntity = (m as MapperBase<any>).entity;
    const entityMetadata = await orm.getEntityMetadata(tableEntity);
    if (entityMetadata.tableName === tableName) {
      metadata = entityMetadata;
      break;
    } else {
      if (
        entityMetadata.ownRelations
          .filter(or => !!or.joinTableName)
          .map(or => or.joinTableName)
          .includes(tableName)
      ) {
        metadata = entityMetadata.ownRelations.find(or => or.joinTableName === tableName);
        break;
      }
    }
  }
  // If no metadata found, we need to do a second pass over the mappers because it could be the case of an
  // Entity that does not have it's own mapper but it is managed by another Entity Mapper.
  if (!metadata) {
    for (const m of mappers) {
      const tableEntity = (m as MapperBase<any>).entity;
      const entityMetadata = await orm.getEntityMetadata(tableEntity);
      if (
        entityMetadata.ownRelations
          .filter(or => !!or.inverseEntityMetadata.tableName)
          .map(or => or.inverseEntityMetadata.tableName)
          .includes(tableName)
      ) {
        metadata = entityMetadata.ownRelations.find(
          or => or.inverseEntityMetadata.tableName === tableName,
        )?.inverseEntityMetadata;
        break;
      }
    }
  }
  return metadata;
}

/**
 * @internal
 * Returns sub-query based on the referenced column in the relation.
 * The related entity will be found using the cloud columns decorators.
 */
async function recreateSubQuery(
  referencedKey: string,
  value: any,
  entityMetadata: EntityMetadata | undefined,
  modsIndexedByTable: { [key: string]: ModuleInterface },
  orm: TypeormWrapper,
): Promise<string> {
  // Get cloud columns of the entity we want to look for.
  const cloudColumns = getCloudId(entityMetadata?.target);
  if (cloudColumns && !(cloudColumns instanceof Error)) {
    let e: any;
    try {
      e = await orm.findOne(entityMetadata?.targetName ?? '', { where: { [referencedKey]: value } });
    } catch (e: any) {
      logger.warn(e.message ?? 'Error finding relation');
      e = null;
    }
    const values = await Promise.all(
      cloudColumns.map(
        async (cc: string) =>
          await findRelationOrReturnFormattedValue(
            entityMetadata?.tableName ?? 'unknown_table',
            cc,
            e[cc],
            modsIndexedByTable,
            orm,
          ),
      ),
    );
    const subQuery = format(
      `SELECT %I FROM %I WHERE ${cloudColumns.map(_ => '%I = %s').join(' AND ')}`,
      referencedKey,
      entityMetadata?.tableName,
      ...cloudColumns.flatMap((cc, i) => [
        snakeCase(cc),
        values[i] !== undefined ? values[i] : '<unknown value>',
      ]),
    );
    return `(${subQuery})`;
  }
  return '';
}
