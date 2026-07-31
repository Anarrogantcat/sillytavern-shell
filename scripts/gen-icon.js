import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import zlib from 'node:zlib';
const __dirname=path.dirname(fileURLToPath(import.meta.url)),SIZE=256,OUT=path.resolve(__dirname,'../assets/icon.png');
const pixels=Buffer.alloc(SIZE*SIZE*4);
for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){const nx=(x/SIZE)*2-1,ny=(y/SIZE)*2-1,d=Math.abs(nx)+Math.abs(ny),i=(y*SIZE+x)*4,outerR=.92,innerR=.55;if(d<=outerR){if(d<=innerR){const isLeft=nx+ny<0,t=(1-d/innerR)*.5+.3;pixels[i]=Math.round((isLeft?180:140)*t);pixels[i+1]=Math.round((isLeft?130:110)*t);pixels[i+2]=Math.round((isLeft?230:210)*t);pixels[i+3]=255;}else{const et=(d-innerR)/(outerR-innerR),sh=1-et*.6;pixels[i]=Math.round(100*sh);pixels[i+1]=Math.round(75*sh);pixels[i+2]=Math.round(155*sh);pixels[i+3]=255;}}}
function crc32(b){let c=0xffffffff;for(let i=0;i<b.length;i++){c^=b[i];for(let j=0;j<8;j++)c=(c>>>1)^(c&1?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const tb=Buffer.from(type,'ascii'),cd=Buffer.concat([tb,data]),cv=Buffer.alloc(4);cv.writeUInt32BE(crc32(cd));return Buffer.concat([len,tb,data,cv]);}
const sig=Buffer.from([137,80,78,71,13,10,26,10]),ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(SIZE,0);ihdr.writeUInt32BE(SIZE,4);ihdr[8]=8;ihdr[9]=6;
const raw=[];for(let y=0;y<SIZE;y++){raw.push(0);const o=y*SIZE*4;for(let x=0;x<SIZE*4;x++)raw.push(pixels[o+x]);}
const png=Buffer.concat([sig,chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(Buffer.from(raw))),chunk('IEND',Buffer.alloc(0))]);
fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,png);console.log('Icon generated:',OUT);
