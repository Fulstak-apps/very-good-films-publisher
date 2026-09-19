import test from 'node:test';
import {execFileSync} from 'node:child_process';
test('all tracked JavaScript entry points parse, including recovery scripts',()=>{
 const files=execFileSync('git',['ls-files','*.mjs'],{encoding:'utf8'}).trim().split('\n');
 for(const file of files)execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
});
