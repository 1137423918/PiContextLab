import { DuckDBInstance } from '@duckdb/node-api';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const root=process.argv[2];if(!root)throw new Error('DATA_DIR');
const db=await DuckDBInstance.create(':memory:',{threads:'2',async_threads:'2',memory_limit:'512MB'});const c=await db.connect();
try{for(const kind of ['queries','corpus']){const r=await c.runAndReadAll('SELECT * FROM read_parquet(?) ORDER BY id',[join(root,kind+'.parquet')]);try{const rows=r.getRowObjectsJson();await writeFile(join(root,kind+'-raw.json'),JSON.stringify(rows));console.log(JSON.stringify({kind,rows:rows.length}));}finally{r.closeSync();}}}finally{c.closeSync();db.closeSync();}
