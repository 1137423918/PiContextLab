import { readFileSync } from 'node:fs';
import { DuckDBInstance } from '@duckdb/node-api';
function memory(stage) { console.log(JSON.stringify({stage,status:readFileSync('/proc/self/status','utf8').split('\n').filter(l=>/^(Vm|Threads)/.test(l)),limits:readFileSync('/proc/self/limits','utf8').split('\n').filter(l=>l.includes('address'))})); }
memory('before');
const db=await DuckDBInstance.create(':memory:',{threads:'2',async_threads:'2',memory_limit:'256MB'});memory('database');const c=await db.connect();memory('connection');
try { const r=await c.runAndReadAll('SELECT 42 value');console.log(JSON.stringify(r.getRowObjectsJson()));r.closeSync();memory('query'); }finally{c.closeSync();db.closeSync();}
