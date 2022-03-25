import { randomBytes } from 'crypto'
import * as fs from 'fs'

import { createConnection, Connection, } from 'typeorm'
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions'

import config from '../config';

// We only want to do this setup once, then we re-use it. First we get the list of files
const migrationFiles = fs
  .readdirSync(`${__dirname}/../migration`)
  .filter(f => !/\.map$/.test(f));
// Then we construct the class names stored within those files (assuming *all* were generated with
// `yarn gen-sql some-name`
const migrationNames = migrationFiles.map(f => {
  const components = f.replace(/\.(js|ts)/, '').split('-');
  const tz = components.shift();
  for (let i = 1; i < components.length; i++) {
    components[i] = components[i].replace(/^([a-z])(.*$)/, (_, p1, p2) => p1.toUpperCase() + p2);
  }
  return [...components, tz].join('');
});
// Then we dynamically `require` the migration files and construct the inner classes
const migrationObjs = migrationFiles
  .map(f => require(`${__dirname}/../migration/${f}`))
  .map((c, i) => c[migrationNames[i]])
  .map(M => new M());
// Finally we use this in this function to execute all of the migrations in order for a provided
// connection, but without the migration management metadata being added, which is actually a plus
// for us.
export async function migrate(conn: Connection) {
  const qr = conn.createQueryRunner();
  await qr.connect();
  for (const m of migrationObjs) {
    await m.up(qr);
  }
  await qr.release();
}

function randomHexValue() {
  return randomBytes(8)
    .toString('hex')
    .toLowerCase()
}

export function genDbId(dbAlias: string) {
  return config.a0Enabled ? `_${randomHexValue()}` : dbAlias;
}

export const baseConnConfig: PostgresConnectionOptions = {
  name: 'base', // If you use multiple connections they must have unique names or typeorm bails
  type: 'postgres',
  username: config.dbUser,
  password: config.dbPassword,
  host: config.dbHost,
  database: 'postgres',
  extra: { ssl: ['postgresql', 'localhost'].includes(config.dbHost) ? false : { rejectUnauthorized: false } },  // TODO: remove once DB instance with custom ssl cert is in place
};

// TODO: The permissions below work just fine, but prevent the users from creating their own
// tables. We want to allow that in the future, but not sure the precise details of how, as
// the various options have their own trade-offs and potential sources of bugs to worry about.
// But we'll want to decide (before public launch?) one of them and replace this
// TODO: #2, also try to roll back the `GRANT CREATE` to something a bit narrower in the future
export function newPostgresRoleQuery(user: string, pass: string, dbId: string) {
  return `
    CREATE ROLE ${user} LOGIN PASSWORD '${pass}';
    GRANT CONNECT ON DATABASE ${dbId} TO ${user};
    GRANT CREATE ON SCHEMA public TO ${user};
  `;
}

export function grantPostgresRoleQuery(user: string) {
  return `
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${user};
    GRANT INSERT ON ALL TABLES IN SCHEMA public TO ${user};
    GRANT UPDATE ON ALL TABLES IN SCHEMA public TO ${user};
    GRANT DELETE ON ALL TABLES IN SCHEMA public TO ${user};
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${user};
    GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA public TO ${user};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${user};
  `;
}

export function dropPostgresRoleQuery(user: string) {
  return `
    DROP ROLE IF EXISTS ${user};
  `;
}

// Create a randomly generated username and password, an 8 char username [a-z][a-z0-9]{7} and a
// 16 char password [a-zA-Z0-9!@#$%^*]{16}
export function genUserAndPass(): [string, string] {
    const userFirstCharCharset = [
      Array(26).fill('a').map((c, i) => String.fromCharCode(c.charCodeAt() + i)),
    ].flat();
    const userRestCharCharset = [
      ...userFirstCharCharset,
      Array(10).fill('0').map((c, i) => String.fromCharCode(c.charCodeAt() + i)),
    ].flat();
    const passwordCharset = [
      ...userRestCharCharset,
      Array(26).fill('A').map((c, i) => String.fromCharCode(c.charCodeAt() + i)),
      '#$.^*'.split(''),
    ].flat();
    const randChar = (a: string[]): string => a[Math.floor(Math.random() * a.length)];
    const user = [
      randChar(userFirstCharCharset),
      Array(7).fill('').map(() => randChar(userRestCharCharset)),
    ].flat().join('');
    const pass = Array(16).fill('').map(() => randChar(passwordCharset)).join('');
    return [user, pass];
}

export function ourPgUrl(dbId: string): string {
  // Using the main user and password, not the users' own account here
  return `postgres://${encodeURIComponent(config.dbUser)}:${encodeURIComponent(
    config.dbPassword
  )}@${config.dbHost}/${dbId}`;
}

export function getEmail(user: any): string {
  // following the format for this auth0 rule
  // https://manage.auth0.com/dashboard/us/iasql/rules/rul_D2HobGBMtSmwUNQm
  // more context here https://community.auth0.com/t/include-email-in-jwt/39778/4
  return config.a0Enabled ? user[`${config.a0Domain}email`] : 'hello@iasql.com';
}

// TODO type user
export function getUid(user: any): string {
  return config.a0Enabled ? user.sub : 'iasql';
}