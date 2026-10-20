'use strict';
const fs=require('node:fs'),path=require('node:path');
const cache=new Map();
const image=/\.(png|jpe?g|webp|gif)$/i;
const allowed=/\.(png|jpe?g|webp|gif|md|txt|pdf|json|log)$/i;
function list(t){
 const prev=cache.get(t.id); if(prev&&prev.root===t.workspace&&Date.now()-prev.at<10000)return prev.items;
 if(!t.workspace||!fs.existsSync(t.workspace))return [];
 const root=fs.realpathSync(t.workspace), found=new Map(); let visited=0;
 function add(p){try{const real=fs.realpathSync(p),rel=path.relative(root,real);if(rel.startsWith('..')||path.isAbsolute(rel)||!allowed.test(real)||/(^|[\\/])(node_modules|\.git|\.local)([\\/]|$)/.test(rel))return;const stat=fs.statSync(real);if(!stat.isFile()||stat.size>24*1024*1024)return;found.set(rel,{file:rel,name:path.basename(real),image:image.test(real),size:stat.size});}catch{}}
 function walk(dir,depth){if(depth<0||visited>800||found.size>=60)return;let entries;try{entries=fs.readdirSync(dir,{withFileTypes:true})}catch{return}for(const e of entries){visited++;if(e.name.startsWith('.')||['node_modules','checks'].includes(e.name))continue;const p=path.join(dir,e.name);if(e.isSymbolicLink())continue;if(e.isDirectory())walk(p,depth-1);else add(p);if(found.size>=60)break;}}
 for(const name of ['art-out','art-boards','textures','图板交付','screenshots','截图'])walk(path.join(root,name),4);
 for(const match of String(t.result||'').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){const target=match[1];if(!/^[a-z]+:\/\//i.test(target))add(path.resolve(root,target));}
 const items=[...found.values()].sort((a,b)=>Number(b.image)-Number(a.image)||a.file.localeCompare(b.file));cache.set(t.id,{at:Date.now(),root:t.workspace,items});return items;
}
function resolve(t,file){const entry=list(t).find(x=>x.file===file);if(!entry)throw new Error('成果不存在或不支持预览');const root=fs.realpathSync(t.workspace),p=fs.realpathSync(path.resolve(root,entry.file)),rel=path.relative(root,p);if(rel.startsWith('..')||path.isAbsolute(rel))throw new Error('成果超出任务目录');return {path:p,...entry};}
module.exports={list,resolve};
