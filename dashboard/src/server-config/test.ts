import { ConfigInterface } from './config';

const test: ConfigInterface = {
  auth: {
    domain: 'https://auth-staging.iasql.com/',
    audience: 'https://api-staging.iasql.com', // id of this api in auth0
  },
  db: {
    host: 'localhost',
    user: 'postgres',
    password: 'test',
    port: 5432,
    forceSSL: false,
  },
};

export default test;
