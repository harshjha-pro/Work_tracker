// Registers the SQLite engine for Node (tests and data scripts).
import initSqlJs from 'sql.js';
import { createRequire } from 'node:module';
import { setSqlJsLoader } from './sqlite';

const require = createRequire(import.meta.url);
setSqlJsLoader(() => initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) }));
