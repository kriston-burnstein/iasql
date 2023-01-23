import * as iasql from '../../src/services/iasql';
import {
  defaultRegion,
  execComposeDown,
  execComposeUp,
  finish,
  getPrefix,
  runBegin,
  runCommit,
  runInstall,
  runInstallAll,
  runQuery,
  runRollback,
  runUninstall,
} from '../helpers';

const prefix = getPrefix();
const dbAlias = 'snstest';

const begin = runBegin.bind(null, dbAlias);
const commit = runCommit.bind(null, dbAlias);
const rollback = runRollback.bind(null, dbAlias);
const query = runQuery.bind(null, dbAlias);
const install = runInstall.bind(null, dbAlias);
const installAll = runInstallAll.bind(null, dbAlias);
const uninstall = runUninstall.bind(null, dbAlias);
const region = defaultRegion();

const modules = ['aws_sns'];
jest.setTimeout(360000);
beforeAll(async () => await execComposeUp());
afterAll(async () => await execComposeDown());

let username: string, password: string;
const topicName = `${prefix}topic`;

describe('AwsSNS Integration Testing', () => {
  it('creates a new test db', done => {
    (async () => {
      try {
        const { user, password: pgPassword } = await iasql.connect(dbAlias, 'not-needed', 'not-needed');
        username = user;
        password = pgPassword;
        if (!username || !password) throw new Error('Did not fetch pg credentials');
        done();
      } catch (e) {
        done(e);
      }
    })();
  });

  it('installs the aws_account module', install(['aws_account']));

  it(
    'inserts aws credentials',
    query(
      `
        INSERT INTO aws_credentials (access_key_id, secret_access_key)
        VALUES ('${process.env.AWS_ACCESS_KEY_ID}', '${process.env.AWS_SECRET_ACCESS_KEY}')
      `,
      undefined,
      false,
      () => ({ username, password }),
    ),
  );

  it('starts a transaction', begin());

  it('syncs the regions', commit());

  it(
    'sets the default region',
    query(
      `
    UPDATE aws_regions SET is_default = TRUE WHERE region = '${region}';
  `,
      undefined,
      true,
      () => ({ username, password }),
    ),
  );

  it('installs the SNS module', install(modules));

  it('starts a transaction', begin());

  it(
    'adds a new SNS topic',
    query(
      `
    INSERT INTO topic (name)
    VALUES ('${topicName}');
  `,
      undefined,
      true,
      () => ({ username, password }),
    ),
  );

  it('sync before apply', rollback());

  it(
    'check no new SNS',
    query(
      `
    SELECT *
    FROM topic
    WHERE name = '${topicName}';
  `,
      (res: any[]) => expect(res.length).toBe(0),
    ),
  );

  it('starts a transaction', begin());

  it(
    'adds a new topic',
    query(
      `
      INSERT INTO topic (name)
      VALUES ('${topicName}');
  `,
      undefined,
      true,
      () => ({ username, password }),
    ),
  );

  it(
    'check adds a new topic',
    query(
      `
    SELECT *
    FROM topic
    WHERE name = '${topicName}';
  `,
      (res: any[]) => expect(res.length).toBe(1),
    ),
  );

  it('applies the topic change', commit());

  it('uninstalls the SNS module', uninstall(modules));

  it('installs the SNS module', install(modules));

  it('starts a transaction', begin());

  it(
    'tries to update a topic autogenerated field',
    query(
      `
      UPDATE topic SET arn = '${topicName}2' WHERE name = '${topicName}';
      `,
      undefined,
      true,
      () => ({ username, password }),
    ),
  );

  it('applies the topic change which will undo the change', commit());

  it(
    'check ARN change has been reverted',
    query(
      `
    SELECT *
    FROM topic
    WHERE name = '${topicName}' AND arn='${topicName}2';
  `,
      (res: any[]) => expect(res.length).toBe(0),
    ),
  );

  it('starts a transaction', begin());

  it(
    'tries to update a field with an incorrect value',
    query(
      `
      UPDATE topic SET tracing_config = 'PassThrough1' WHERE name = '${topicName}';
      `,
      undefined,
      true,
      () => ({ username, password }),
    ),
  );

  it('checks that value gets rejected', () => {
    try {
      commit();
    } catch (e) {
      expect(e).toBeTruthy();
    }
  });

  it('performs a rollback that will revert the change', rollback());

  it(
    'check tracing config change has been reverted',
    query(
      `
    SELECT *
    FROM topic
    WHERE name = '${topicName}' AND tracing_config='PassThrough1';
  `,
      (res: any[]) => expect(res.length).toBe(0),
    ),
  );

  it('starts a transaction', begin());

  it(
    'tries to update a field with an correct value',
    query(
      `
      UPDATE topic SET tracing_config = 'PassThrough' WHERE name = '${topicName}';
      `,
      undefined,
      true,
      () => ({ username, password }),
    ),
  );

  it('applies the topic change which will be correct', commit());

  it(
    'check tracing config change has been applied',
    query(
      `
    SELECT *
    FROM topic
    WHERE name = '${topicName}' AND tracing_config='PassThrough';
  `,
      (res: any[]) => expect(res.length).toBe(1),
    ),
  );

  it('starts a transaction', begin());

  it(
    'deletes the topic',
    query(
      `
      DELETE FROM topic
      WHERE name = '${topicName}';
      `,
      undefined,
      true,
      () => ({ username, password }),
    ),
  );

  it('applies the topic delete', commit());

  it(
    'check deletes the topic',
    query(
      `
    SELECT *
    FROM topic
    WHERE name = '${topicName}';
  `,
      (res: any[]) => expect(res.length).toBe(0),
    ),
  );

  it('deletes the test db', done => void iasql.disconnect(dbAlias, 'not-needed').then(...finish(done)));
});

describe('AwsSNS install/uninstall', () => {
  it('creates a new test db', done => {
    (async () => {
      try {
        const { user, password: pgPassword } = await iasql.connect(dbAlias, 'not-needed', 'not-needed');
        username = user;
        password = pgPassword;
        if (!username || !password) throw new Error('Did not fetch pg credentials');
        done();
      } catch (e) {
        done(e);
      }
    })();
  });

  it('installs the aws_account module', install(['aws_account']));

  it(
    'inserts aws credentials',
    query(
      `
        INSERT INTO aws_credentials (access_key_id, secret_access_key)
        VALUES ('${process.env.AWS_ACCESS_KEY_ID}', '${process.env.AWS_SECRET_ACCESS_KEY}')
      `,
      undefined,
      false,
      () => ({ username, password }),
    ),
  );

  it('starts a transaction', begin());

  it('syncs the regions', commit());

  it(
    'sets the default region',
    query(
      `
    UPDATE aws_regions SET is_default = TRUE WHERE region = 'us-east-1';
  `,
      undefined,
      true,
      () => ({ username, password }),
    ),
  );

  it('installs the SNS module', install(modules));

  it('uninstalls the SNS module', uninstall(modules));

  it('deletes the test db', done => void iasql.disconnect(dbAlias, 'not-needed').then(...finish(done)));
});
