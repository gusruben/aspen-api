# `aspen-api`

> An API client library for interacting with Aspen, a Student Information System (SIS) created by Follett and used in schools around the U.S.

This package is a work-in-progress. Some features may be missing or not fully fleshed-out!

## Installation

`aspen-api` can be installed from NPM with your node package manager of choice:

```sh
npm install aspen-api
```

```sh
yarn install aspen-api
```

```sh
pnpm install aspen-api
```

> Note: `aspen-api` is [ESM](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules), rather than CommonJS. That means that if you want to use it in a project written in CommonJS, you need to either convert your project to ESM, or use the [`import()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import) function.

## Usage

You can access Aspen through a single class. You need to initiate it using your 'district ID.' All Aspen instances are hosted at a subdomain of [myfollett.com](https://myfollett.com), though some districts might  have students use a different domain, for example, [aspen.dcps.dc.gov](https://aspen.dcps.dc.gov) -> [dcps.myfollett.com](https://dcps.myfollett.com).

```ts
import Aspen from "aspen-api";

const aspen = new Aspen("dcps");
```

Once you've created an `Aspen` object, you need to log in:

```ts
// store your login however you want!
const username = process.env.USERNAME
const password = process.env.PASSWORD

await aspen.login({ username, password })
```

## API

### Aspen

Everything in `aspen-api` is stored in a central `Aspen` class.

#### `constructor(id: string, cookies? Cookie[])`

Constructs a new `Aspen` object. The `id` is the subdomain of `<id>.myfollett.com`. Cookies can be passed in using an array of [`Cookie`](https://github.com/salesforce/tough-cookie#cookie) objects. `aspen-api` uses [`tough-cookie`](https://www.npmjs.com/package/tough-cookie) for managing cookies. If you want to save an Aspen session and reconstruct it later, this is the recommended way to do it.

```ts
import Aspen from "aspen-api";

const aspen = new Aspen("dcps");
```

#### `login(options: { username: string, password: string })`

```ts
// store your login however you want!
const username = process.env.USERNAME;
const password = process.env.PASSWORD;

await aspen.login({ username, password });
```

#### `getClasses()`

**Returns: `Promise<ClassInfo[]>`**

Gets a list of all the classes, along with info about them.

```ts
const classes = await aspen.getClasses();
```

#### `getClass(token: string)`

**Returns: `Promise<ClassData>`**

Gets data about a class, including grades. The `token` is a sort of identifier for the class, it comes in the data from the `getClasses` function.

```ts
// grab this earlier from getClasses()
const token = // ...

const mathClass = await getClass(token);
```

#### `getAssignments(token: string)`

**Returns: `Promise<Assignment[]>`**

Gets the list of assignments from a class.

```ts
// grab this earlier from getClasses()
const token = // ...

const mathAssignments = await getAssignments(token);
```

#### `getSchedule()`

**Returns: `Promise<Schedule>`**

Gets the current schedule of the current student.

#### `getCookies()`

**Returns: `Promise<Cookie[]>`**

Gets a list of all the stored cookies.

## Types

See [`types.ts`](https://github.com/gusruben/aspen-api/blob/main/src/types.ts).
