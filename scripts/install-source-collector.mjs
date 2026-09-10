import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const root=path.resolve('.');
// One supervisor owns collection, queue repair, and workflow dispatch. Running
// a second collector timer against the same checkout causes Git and state races.
const plist=path.join(os.homedir(),'Library','LaunchAgents','com.verygoodfilms.recovery.plist');
const logs=path.join(os.homedir(),'Library','Logs');
await fs.mkdir(path.dirname(plist),{recursive:true});await fs.mkdir(logs,{recursive:true});
const command=`export PATH=\"/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin\"; cd \"${root}\" &amp;&amp; /opt/homebrew/bin/node scripts/local-recovery.mjs`;
await fs.writeFile(plist,`<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict><key>Label</key><string>com.verygoodfilms.recovery</string><key>ProgramArguments</key><array><string>/bin/zsh</string><string>-lc</string><string>${command}</string></array><key>StartInterval</key><integer>300</integer><key>RunAtLoad</key><true/><key>StandardOutPath</key><string>${path.join(logs,'verygoodfilms-recovery.log')}</string><key>StandardErrorPath</key><string>${path.join(logs,'verygoodfilms-recovery-error.log')}</string></dict></plist>\n`);
console.log(plist);
