// 用法: node scripts/check_stories.js  —— 统计每个故事用到的字，以及按学习顺序在第几阶达到 ≥95% 已学字
var fs=require("fs"),path=require("path"),root=path.join(__dirname,"..");
global.window=global;
(0,eval)(fs.readFileSync(root+"/hanzi_data.js","utf8")); (0,eval)(fs.readFileSync(root+"/stories.js","utf8"));
var BYC={};HANZI_DB.forEach(h=>BYC[h.c]=h);
var ORDER=HANZI_DB.slice().sort((a,b)=>a.n-b.n).map(h=>h.c);
function strip(t){STORY_NAMES.slice().sort((a,b)=>b.length-a.length).forEach(n=>{t=t.split(n).join("")});return t;}
var all={},miss={},out=[];
READERS.forEach(s=>{var txt=s.title+s.lines.map(l=>l[1]).join("");
 var hz=strip(txt).match(/[\u4e00-\u9fff]/g)||[]; var u=[...new Set(hz)];
 u.forEach(c=>{all[c]=1;if(!BYC[c])miss[c]=1;});
 var st=-1;for(var s2=0;s2<400;s2++){var k=new Set(ORDER.slice(0,8+6*s2));var bad=hz.filter(c=>!k.has(c)).length;if(1-bad/hz.length>=0.95){st=s2;break;}}
 var k=new Set(ORDER.slice(0,8+6*st)); out.push([s.id,s.title,"stage",st,"chars",8+6*st,"tokens",hz.length,"known%",(100*(1-hz.filter(c=>!k.has(c)).length/hz.length)).toFixed(1),"unknown:",[...new Set(hz.filter(c=>!k.has(c)))].join("")]);});
out.forEach(r=>console.log(r.join(" ")));
console.log("distinct chars",Object.keys(all).length,"not in DB:",Object.keys(miss).join(""));
STORY_NAMES.join("").split("").forEach(c=>{if(!BYC[c])console.log("name char missing",c)});
