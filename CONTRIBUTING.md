# Contributing

Thanks for your interest in helping improve IaSQL! 🎉

If you are looking for IaSQL's documentation, go here instead: https://iasql.com/docs

This document is for people who want to contribute to IaSQL. There are multiple ways to contribute to the project other than code, such as reporting bugs, creating feature requests, helping other users in online spaces, Discord etc.

Table of contents
=================

  * [Get Involved](#get-involved)
    * [Contributor L1](#contributor-L1)
    * [Contributor L2](#contributor-L2)
  * [How IaSQL works](#how-iasql-works)
  * [How to run IaSQL locally](#how-to-run-iasql-locally)
  * [How to test IaSQL locally](#how-to-test-iasql-locally)
    * [Migrations](#migrations)
  * [How to test IaSQL via CI](#how-to-test-iasql-via-ci)
    * [Common integration tests](#common-integration)
    * [Modules](#modules)
  * [How to release IaSQL via CI](#how-to-release-iasql-via-ci)
  * [`apply` and `sync` Behavior](#apply-and-sync-behavior)
    * [Terminology](#terminology)
    * [Read-Diff-Execute Loop](#read-diff-execute-loop)
    * [Why does Step 7 exist?](#why-does-step-7-exist?)
  * [Module Mapper Footguns](#module-mapper-footguns)
  * [How IaSQL PostgreSQL functions work](#how-iasql-postgresql-functions-work)

## Get Involved

Anyone can become an IaSQL Contributor regardless of skill level, experience, or background. All types of contributions are meaningful. Our membership system was designed to reflect this.

**Anything that supports the IaSQL community is a contribution to the project.** This includes but is not limited to:
  - Submitting (and Merging) a Pull Request
  - Filing a Bug Report or Feature Request
  - Updating Documentation
  - Answering questions about IaSQL on GitHub or Discord
  - Answering questions on Discord, Stack Overflow, Twitter, etc.
  - Blogging, Podcasting, or Live streaming about IaSQL

## Membership Levels, Roles and Responsibilities

### Contributor L1

Have you done something to contribute to the health, success, or growth of IaSQL? Congratulations, you're officially a contributor!

**Benefits:**
- Contributor status on the [IaSQL Discord server](https://discord.com/invite/yxNBQugGbH)

**Nomination:**
- Self nominate by posting the qualifying contribution in Discord (link preferred).

### Contributor L2 (Committer)

**Contributor L2** membership is reserved for users that have shown a commitment to the continued development of the project through ongoing engagement with the community. At this level, contributors are given push access to the project's GitHub repos and must continue to abide by the project's Contribution Guidelines and Code of Conduct.

Anyone who has made several significant (non-trivial) contributions to IaSQL can become a Contributor in recognition of their work. An example of a "significant contribution" might be:
- ✅ Triaging and supporting non-trivial Discord and GitHub issues
- ✅ Submitting and reviewing non-trivial PRs
- ✅ Submitting and reviewing non-trivial documentation edits (multiple sections/pages)
- ❌ A typo fix, or small documentation edits of only a few sentences

**Responsibilities:**
- May request write access to relevant IaSQL projects.
- GitHub: May work on public branches of the source repository and submit pull requests from that branch to the main branch.
- GitHub: Must submit pull requests for all changes, and have their work reviewed by other members before acceptance into the repository.
- GitHub: May merge pull requests the opened once they have been approved.

**Benefits:**
- Committer status on the [IaSQL Discord server](https://discord.com/invite/yxNBQugGbH)
- IaSQL swag mailed to you!

**Nomination:**
- A nominee will need to show a willingness and ability to participate in the project as a team player.
- Typically, a nominee will need to show that they have an understanding of and alignment with the project, its objectives, and its strategy.
- Nominees are expected to be respectful of every community member and to work collaboratively in the spirit of inclusion.
- Have submitted a minimum of 5 qualifying significant contributions (see list above).
- You can be nominated by any existing Committer or Maintainer.
- Once nominated, there will be a vote by existing Maintainers.

## How IaSQL works

IaSQL treats infrastructure as data by maintaining a 2-way connection between a cloud account and a PostgreSQL database. IaSQL is an eventually-consistent design where changes to the SQL tables are pushed into the cloud and changes from the cloud are pushed into the SQL tables. This means that IaSQL generates a diff between the cloud and the database and then compares to an audit log to determine the source of any found differences and then executes the logic necessary to push the change from the "source" side to the "destination" side. It's eventually consistent so multiple changes can be queued up without latency on the user's side by default, but the changes can be made blocking by entering a transaction-like mode, making the changes to the database, and then committing it, which will block until completion.

There are a couple of places (like security group IDs) where we can't avoid the ID being generated by the cloud instead of ourselves within postgres. These are nullable columns that we eventually fill in once the security group is created during the creation process. Similarly, things that depend on other things with nullable columns will fail if that column is still null, but IaSQL will automatically re-try failed operations if the set of operations to perform changes between attempts (meaning some forward progress has been made) so inserting security group rules for a security group that has not yet been created will not fail, but may take a bit more time depending on the execution order it determined internally.

## How to run IaSQL locally

This repo houses IaSQL which is a Postgres Docker container with a Node.js sidecar process written in Typescript to give it cloud powers. ☁️  Make sure `docker` is installed locally, then you can build IaSQL with:

```sh
docker build -t iasql:latest .
```

or simply `yarn docker-build` if you have `yarn` installed. You can then run a local IaSQL instance with:

```sh
docker run -p 5432:5432 --name iasql iasql:latest
```

or simply `yarn docker-run` if you have `yarn` installed.

By default, the IaSQL docker is configured to use the values from `src/config/local.ts`. The Postgres super-admin user will be `postgres` and its password `test`. To create a new database in your local Postgres engine and connect it to an AWS account (and whatever region you prefer) send the following SQL query to the 'iasql_metadata' database:

```bash
psql postgres://postgres:test@localhost:5432/iasql_metadata -c "SELECT * FROM iasql_connect('db_name');"
```

This will return the specially-made username and password for your new database. Connecting to the database is a simple as:

```bash
psql postgres://<username>:<password>@127.0.0.1:5432/db_name
```

You are off to the races! You'll likely want to manipulate an AWS account, so you'll want to install the `aws_account` module:

```sql
SELECT * FROM iasql_install('aws_account');
```

And then insert your credentials and AWS region:

```sql
INSERT INTO aws_account (access_key_id, secret_access_key, region)
VALUES ('AKIASOMEKEYHERE', 'somesecrethere', 'us-east-2');
```

If you wish to disconnect the local database from the AWS account and remove it from IaSQL simply run:

```bash
psql postgres://postgres:test@localhost:5432/iasql_metadata -c "SELECT iasql_disconnect('db_name');"
```

## How to develop IaSQL

Instead of a centralized linear list of migrations, we have a module-based approach to allow different collections of tables to be inserted or removed as desired by the end users. These modules need to declare what modules they depend on and what resources (tables, stored procedures, etc) they depend on.

Development of a new module is expected to follow this pattern:

1. Create the module directory, and create `entity` and `migration` directories inside of it.
2. Create the entity or entities in the `entity` directory and export them all from the `index.ts` file (or just define them in there).
3. Run the `yarn gen-module my_new_module_name` script and have it generate the migration file. (`my_new_module_name` needs to match the directory name for the module in question.)
4. Write the module's `index.ts` file. It must implement the `MapperInterface` inside of `modules/interfaces.ts`, which also requires importing and constructing `Mapper` and `Crud` objects.

Development of an existing module is expected to follow this pattern:

1. Make the changes to the entities that you want to make.
2. Run the `yarn gen-module my_existing_module_name` script and have it generate a new migration file. (`my_existing_module_name` needs to match the directory name for the module in question.)
3. Commit the removal of the old migration and add in the new one. You can only have one migration file per module.

### Migrations

IaSQL's modules require the migration file to either be generated by TypeORM, or to be in that form, which is a typescript file that exports a single class with two methods: an `async up` and an `async down`. They both accept a TypeORM `QueryRunner` object and return nothing. Any usage of this queryRunner as supported by TypeORM is allowed, but the simplest usage is `await queryRunner.query(someSqlString);`.

The `up` defines the creation of the SQL schema necessary for your module, and `down` is the removal of that same schema. If you do not use `yarn gen-module` to create this file, it is up to you to make sure the downgrade path fully removes everything added in the upgrade path.

## How to test IaSQL locally

To run the integration tests locally make sure to point to an existing AWS account by setting the following environment variables.

```
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
```

Run `yarn test:local` which will set the `IASQL_ENV` to `test` for you. To run a specific test file only, simply pass it as a parameter `yarn test:local test/modules/aws-cloudwatch-integration.ts`

## How to test IaSQL via CI

### Common integration

Common tests are inside `test/common/` directory. This tests run sequentially and they use the `Testing` account. To add a new test just create the file inside the common directory and it will run automatically.

### Modules

Modules tests are inside `test/modules/` directory. Currently, every module has a dedicated test account with credentials given via Github Actions secrets and every test run picks an AWS regions within that test account via the [CI setup](https://github.com/iasql/iasql/blob/main/.github/workflows/ci.yml#L84). Modules tests run in parallel with each other but sequentially within each module file and each use a specific account per module to avoid rate limits per account. To add a new test:

- Create the test file inside `test/modules`. The current pattern to name the file is `aws-<aws-service>-integration`.
- Run the tests. It will parallelize the test runs by file.

## How to release IaSQL via CI

### 1. Release the newest version

Go to ["Version: Release Newest" tab](https://github.com/iasql/iasql/actions/workflows/release.yml) in the repository Actions tab. Then click the "Run Workflow" button to mark the newest version as released.

### 2. Deploy Production

Go to ["Deploy to Production" tab](https://github.com/iasql/iasql/actions/workflows/production.yml) in the repository Actions tab. Next click the "Run Workflow" button. Then type in the new version number to deploy and finally click the green "Run workflow" button.

### 3. Begin development of the next version

Go to ["Version: Start New Development" tab](https://github.com/iasql/iasql/actions/workflows/release-develop.yml) in the repository Actions tab. Next click the "Run Workflow" button. Then type in the new version number for the next release and finally click the green "Run workflow" button. It will create a commit with that version with a `-beta` appended to it to make it clear this and following commits are not for users to work with directly.

### 4. Develop!

Write PRs and merge them as you normally would.

### 5. GOTO 1.

## Eventually Consistent Behavior and Transactions

This is an overview of how IaSQL detects changes in your database and/or cloud and performs operations to make them the same (in one direction or the other). This assumes knowledge of [IaSQL transactions](https://iasql.com/docs/transaction/) at the high level, software development in general and some familiarity with the IaSQL codebase in particular, though it links to relevant pieces when they are being discussed.

To explain how IaSQL works we are going to explain the functions in a transaction-like way and we will close by explaining how the eventually consistent behaviour is achieved.

### `iasql_begin`

This method is used to open a transaction. It first checks if there's no other open transaction and then inserts a new record in the `iasql_audit_log` table. Every open transaction record older than 30 minutes without its paired closed transaction record will be ignored while checking if another transaction is open.

### `iasql_commit`

This can only happen if a transaction has been opened first. This function executes the following steps:

1. Insert a new "start commit" record in `iasql_audit_log`.
2. Get the previous start commit record.
3. Get all the changes to commit. It will be all changes between the previous start commit record and the current one.
4. Then we apply (we will explain this step later) only for the modules that have changes to be committed.
    1. If the apply fails, we apply again but with all the modules installed. This need to be done in case there's a configuration drift in another module that is blocking the apply to occur successfully.
5. When the changes have been applied, we sync from the cloud into the database to keep it up-to-date.
6. No matter what happened during the commit execution, we insert a new end commit record in the `iasql_audit_log` table.

If the commit operation fails we revert all changes before closing the transaction. It will recreate all changes in the audit log table as "inverse queries" and `apply` them. These inverse queries will handle any `INSERT` statement as a `DELETE` statement and `DELETE`s as `INSERT`s.

### `iasql_rollback`

This can only happen if a transaction has been opened first. It help us synchronize again the state of the cloud in our database discarding changes done to the DB since `iasql_begin` and that have not been committed. This function executes the following steps:

1. Insert a new "start commit" record in `iasql_audit_log`.
2. Make a cloud synchronization into the database to restore possible changes done by the user that have not been applied.
3. Insert a new end commit record in the `iasql_audit_log` table.

### `iasql_preview`

This method is the same as commit, with the difference that it runs with a `dryRun` flag that will just spot the differences and return before trying to apply them.

### Read-Diff-Execute Loop (apply and sync)

 The [`apply`](https://github.com/iasql/iasql/blob/main/src/modules/iasql_functions/iasql.ts#L859) and [`sync`](https://github.com/iasql/iasql/blob/main/src/modules/iasql_functions/iasql.ts#L1098) functions are very similar dual `do-while` loops that execute the following steps:

1. For every `mapper` provided (it will depend if we are in the first apply phase of the commit where we only have the mappers of the modules that have changes or the second where we will have all of them), load all database records into their associated `entities` using the database `read` function from the `mapper`.
2. Recreate all possible changes that might have occurred after the current `iasql_commit` started in order to exclude them during this apply execution.
3. Repeat this process for the cloud, by using the cloud Read functions from the `mapper`s.
4. All the changes to be committed are only JSON values, so we need to recreate the respective entities to be able to compare them.
5. For each `mapper`, generate the IDs for relevant database and cloud entities and intersect these two sets to produce three new sets: entities only in the database, entities only in the cloud, and entities in both.
6. For the set of entities in both, execute an entity diffing function using the `mapper`'s `equals` method to determine which of the entities in both database and cloud are the same, and which have differences. Then discard the entities that are the same, leaving a set of entities that have changed.
7. Convert these sets into actions to take. Specifically, argument-less functions that when called return a new Promise to perform the action, so it may be called again if failed but *suspected* to be able to succeed in the future. The way the sets are converted into tasks depends on whether this is an `apply` or a `sync`. On `apply` entities only in the database become cloud creates, while entities only in the cloud become cloud deletes, and entities changed become cloud updates. For `sync` entities only in the database become database deletes, entities only in the cloud become database creates, and entities changed become database updates.
8. Try to [run all of these promises and keep track of which ones succeeded and which failed](https://github.com/iasql/blob/main/src/services/lazy-dep.ts#L13). If there are any errors, and the number of errors is *different* from the last execution, then re-schedule the errored-out tasks and try to run them again, until either the failure mode is consistent or every task has succeeded. This approach allows the implicit dependency graph between tasks to execute and settle out naturally without needing an explicit dependency graph. (The module dependency graph and operation types are used to roughly sort them, but because some AWS services have cycles in their dependencies, a traditional DAG-to-list algorithm can't be relied on).
9. If this is `apply` reload only the *cloud* state, while if this is `sync` reload only the *database* state, and repeat from step 5. If there is no more work detected to be done, then repeat step 1. If there is *again* no work to be done, we're finally finished. This last "step" is tricky and why it's a double `do-while` loop to implement things. Read on below for more on why this is.

#### Why does Step 9 exist?

 If we were updating/synchronizing between two different databases, Step 9 is 100% not necessary and you can handle everything without any looping (beyond the task transient error handling loop in step 8).

 This is because in the database everything is mutable. But the cloud is not exactly like that. Some cloud entities cannot be changed after they have been created. They can only be replaced. You also can't just issue a delete and then an insert, because other entities that depend on the entity you're trying to replace are still there and the delete operation on your current entity will not eliminate those other entities, but will instead error out.

 What you need to do is only create a new entity that matches the database, and then on the next loop it will notice that it should delete the entity that isn't in the database and the *other* entities will notice that they are associated with the wrong entity and trigger their update or replace to swap to the new entity you just created. These tasks will potentially clash with each other but the error-retrying-loop should eventually execute them in the correct order and you're done.

 That explains one loop, so why the other? Because of create-only entities that *also* have unique constraints on one or more properties. The AWS Security Group qualifies as one of these. Once you create a security group and set its description, you can't change it, but in IaSQL you certainly can do so. If you update the description, which is not unique but leaves the name alone, which is unique, you can't just create a replacement security group with the same name. So the security group mapper has to do something gnarly here. When it creates the replacement, it mutates the name to a randomly generated one and then mutates the internal cache of the DB record to match that randomly generated name.

 Now when it does this replacement, it first sees that it is supposed to mutate the security group description without mutating the name but alters the name in its cache and executes a cloud create with this new, fake record. Then the inner loop runs and entities connected to the security group "realize" they are on the wrong security group and switch to this new, temporary security group, while the old security group with the correct name is marked as cloud-only so it is deleted. Then the inner loop completes with no difference between the database *cache* and the cloud, so it goes back to the outer loop, which re-loads the *actual* database state and it checks again and sees that there's a security group in the database that is not in the cloud and a security group in the cloud that is not in the database and that these other entities are connected to the wrong security group, so it creates tasks to create a security group, delete a security group, and switch security groups. The error-retrying-loop will execute these tasks some unknown number of times, but the successes will always be in the same order -> create security group -> switch other entities to that security group -> delete the temporary security group.

 This dance is necessary to give users in IaSQL the ability to migrate from *any* cloud state to the state they have defined in their database. This is IaSQL's superpower: bringing a greater reliability to producing the cloud state the developer specifies, so they can worry about more important things.

### Eventual Consistency Behavior

With all the methods already exposed, we can achieve the 2-way mode eventual consistent behaviour by using the `pg_cron` extension starting every 2 minutes a new transaction and executing `iasql_commit`in order to apply and/or sync necessary changes.

## Module Mapper Footguns

This section will change much more frequently compared to the other sections.

* TypeORM sometimes violates the entity types you have provided, especially around nullable types, where the entity may be something like `foo?: string` which implies `string | undefined` but TypeORM will treat it as `string | null`. This can trip you up in the `equals` function as `Object.is` distinguishes between `undefined` and `null` so you will run into infinite `update` loops where it is detecting a difference but there is no actionable change to be had. [We currently re-adjust TypeORM output after to read or writes to the database to avoid this](https://github.com/iasql/blob/main/src/modules/0.0.15/aws_security_group/entity/index.ts#L51-L59). (Similarly sometimes arrays are actually unordered sets, so comparing array element-by-element is incorrect and you need to check each element is inside of the other array, regardless of order, and some strings are actually JSON or other human-editable data formats and non-significant-whitespace differences can also cause `update` loops.
* Deeply-nested entities get translated into many tables in TypeORM, and unique constraints on those tables can cause lots of pain with the entities that were generated from the cloud APIs, as they don't have the the database-only columns that let TypeORM know when the entity already exists in the database. Unfortunately for now you have to manually find these duplicates and then patch your sub-entity with these DB-only fields or the DB CRUD operations will blow up in your face.
* Picking the right field for the `@cloudId` in order to both: 1) properly distinguish records in the cloud and 2) still support distinguishing records in the database can sometimes be a difficult job, particularly if the only real candidate is a cloud-generated property.
* Records that are actually really read-only from the cloud and can't actually be mutated by end users (but are still useful to have to make inserts/updates of other entities safer via join logic) need to have weirdly "backwards" cloud CRUD functions that grab the cloud cache record and re-save it to the database (or delete the user-inserted entity outright).
* The create-only/create-only-with-unique-columns entities currently require [100% type-unsafe actions to manipulate the DB cache](https://github.com/iasql/blob/main/src/modules/0.0.15/aws_security_group/index.ts#L171). There are other sections of the codebase where type safety / guarding by the compiler is broken, but this is the worst/most-dangerous one.
* When an entity depends on another entity, it is *best* to join it on a database ID rather any string ID preferred by the cloud. This is because then updates to that string ID are automatically picked up by the mappers of the other entities to perform an update automatically with minimal fuss for the user of IaSQL *and* reduced iterations inside of IaSQL itself. The second-best choice is to use a string ID that is defined by the user, not the cloud, so if they want to change that identifier, they will at least get a database foreign key error from it and have to themselves first un-join the entities in question, make the change, and then join them back. Making the join column a cloud-generated ID means any time there's a `replace`-style update occurring anything that joins on it will simply *break* and IaSQL will not be able to figure out how to stitch things back together so **don't do that.**

There are probably many other footguns at the moment, feel free to update this with any you can think of!

## How IaSQL PostgreSQL functions work

The IaSQL container consists of two components:
- An [Express.js server](https://github.com/iasql/blob/c12d773402ad60d3c848743ced400584c08fcf8e/src/index.ts#L73-L77) on 8088 port (only accessible from within the container, therefore no direct access from outside)
- IaSQL [Postgres database](https://github.com/iasql/blob/c12d773402ad60d3c848743ced400584c08fcf8e/docker-entrypoint.sh#L47) which is listening on port 5432. This port is also exposed to the public so that the users are able to connect to their databases.

The communication between the database and server takes place via HTTP requests to the Express.js server. Whenever an IaSQL RPC command is called on the database (`SELECT iasql_install(...)`, `SELECT iasql_commit()`, or more generally `iasql_*`), an HTTP post request is sent from the Postgres database to the Express.js server. [Using](https://github.com/iasql/blob/c12d773402ad60d3c848743ced400584c08fcf8e/src/modules/interfaces.ts#L467-L482) the [`pgsql-http` Postgres extension](https://github.com/pramsey/pgsql-http) to send HTTP requests from the Postgres database to the Express.js server.

<img alt="IaSQL Container" src="assets/IaSQL-container.png" width="300"/>

The Express.js server is trusting the input that it gets from the HTTP requests because they're all coming from the database and the `pg_http` calls in the database are configured in a pseudo-fixed structure that should not allow arbitrary requests.
