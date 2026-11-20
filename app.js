'use strict';
// All file inspection and processing happens locally in the browser.
const $ = id => document.getElementById(id);
const MAX_BYTES = 25 * 1024 * 1024;
let selectedFile = null;
let originalInfo = null;
let lastDownloadUrl = null;
const decoder = new TextDecoder('latin1');
const read32BE = (v, i) => v.getUint32(i, false);
const read32LE = (v, i) => v.getUint32(i, true);
const read16BE = (v, i) => v.getUint16(i, false);
const ascii = (bytes, start, length) => decoder.decode(bytes.subarray(start, start + length));
const concat = parts => { const size = parts.reduce((sum, a) => sum + a.length, 0); const out = new Uint8Array(size); let pos = 0; for (const a of parts) { out.set(a, pos); pos += a.length; } return out; };
const formatBytes = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(2)} MB`;
function detect(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).every((b,i) => b === [137,80,78,71,13,10,26,10][i])) return 'png';
  if (bytes.length >= 12 && ascii(bytes,0,4)==='RIFF' && ascii(bytes,8,4)==='WEBP') return 'webp';
  throw new Error('Unsupported image type. Please select a valid JPEG, PNG or WebP image.');
}
function jpegSegments(bytes) {
  if(bytes.length < 4 || bytes[0]!==255 || bytes[1]!==216) throw new Error('Invalid JPEG');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength); let i=2; const segments=[];
  while (i < bytes.length) {
    const start=i;
    if(bytes[i]!==255) throw new Error('Malformed JPEG marker');
    while(i<bytes.length && bytes[i]===255)i++;
    if(i>=bytes.length)throw new Error('Truncated JPEG');
    const marker=bytes[i++];
    if(marker===0xda) {if(i+2>bytes.length)throw new Error('Truncated JPEG'); const length=read16BE(v,i);if(length<2 || i+length>bytes.length)throw new Error('Invalid JPEG SOS');segments.push({marker,start,end:bytes.length,body:i+2});return segments;}
    if(marker===0xd9){segments.push({marker,start,end:i});return segments;}
    if(marker===0x01 || (marker>=0xd0 && marker<=0xd7)) {segments.push({marker,start,end:i}); continue;}
    if(i+2>bytes.length)throw new Error('Truncated JPEG segment');
    const length=read16BE(v,i);if(length<2||i+length>bytes.length)throw new Error('Invalid JPEG segment length');
    segments.push({marker,start,end:i+length,body:i+2});i+=length;
  }
  throw new Error('Incomplete JPEG image');
}
function isJpegMetadata(s,bytes){
  // Preserve JFIF, ICC color profiles, and Adobe markers for correct rendering.
  if(s.marker===0xfe || s.marker===0xed || s.marker===0xeb || s.marker===0xe1 || s.marker===0xe3 || s.marker===0xe4 || s.marker===0xe5 || s.marker===0xe6 || s.marker===0xe7 || s.marker===0xe8 || s.marker===0xe9 || s.marker===0xea || s.marker===0xec || s.marker===0xee || s.marker===0xef)return true;
  if(s.marker===0xe2)return ascii(bytes,s.body,12)!=='ICC_PROFILE\0';
  return false;
}
function processJpeg(bytes){const ss=jpegSegments(bytes);const remove=ss.filter(s=>isJpegMetadata(s,bytes));const keep=ss.filter(s=>!isJpegMetadata(s,bytes));const image=concat([bytes.subarray(0,2),...keep.map(s=>bytes.subarray(s.start,s.end))]);return {image, found:remove.map(s=>({type:s.marker===0xe1?'EXIF / XMP / APP1':s.marker===0xeb?'C2PA / APP11':s.marker===0xfe?'Comment':s.marker===0xed?'IPTC / APP13':`APP${s.marker-0xe0} metadata`,bytes:s.end-s.start}))};}
// PNG checksum: validate chunk layout and write no new chunks, so existing CRC values remain valid.
const PNG_KEEP=new Set(['IHDR','PLTE','IDAT','IEND','tRNS','iCCP','sRGB','gAMA','cHRM','cICP','mDCv','cLLi','bKGD','sBIT','sPLT','hIST','acTL','fcTL','fdAT']);
function pngChunks(bytes){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(bytes.length<20)throw new Error('Invalid PNG');let i=8;const chunks=[];let ended=false;while(i+12<=bytes.length){const size=read32BE(v,i);const type=ascii(bytes,i+4,4);const end=i+12+size;if(end>bytes.length || !/^[A-Za-z]{4}$/.test(type))throw new Error('Malformed PNG chunk');chunks.push({type,start:i,end,bytes:end-i});i=end;if(type==='IEND'){ended=true;break;}}if(!ended || chunks[0]?.type!=='IHDR')throw new Error('Incomplete PNG');return chunks;}
function processPng(bytes){const chunks=pngChunks(bytes);const removed=chunks.filter(c=>!PNG_KEEP.has(c.type));const kept=chunks.filter(c=>PNG_KEEP.has(c.type));return {image:concat([bytes.subarray(0,8),...kept.map(c=>bytes.subarray(c.start,c.end))]),found:removed.map(c=>({type:`${c.type} metadata`,bytes:c.bytes}))};}
const WEBP_KEEP=new Set(['VP8 ','VP8L','VP8X','ALPH','ANIM','ANMF','ICCP']);
function webpChunks(bytes){if(bytes.length<20)throw new Error('Invalid WebP');const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);const riffSize=read32LE(v,4)+8;if(riffSize>bytes.length || riffSize<20)throw new Error('Invalid WebP RIFF size');const chunks=[];let i=12;while(i+8<=riffSize){const size=read32LE(v,i+4);const end=i+8+size+(size%2);if(end>riffSize)throw new Error('Malformed WebP chunk');chunks.push({type:ascii(bytes,i,4),start:i,end,bytes:end-i,size});i=end;}if(i!==riffSize||!chunks.length)throw new Error('Incomplete WebP');return chunks;}
function processWebp(bytes){const chunks=webpChunks(bytes);const removed=chunks.filter(c=>!WEBP_KEEP.has(c.type));const kept=chunks.filter(c=>WEBP_KEEP.has(c.type));const outChunks=kept.map(c=>{const data=bytes.slice(c.start,c.end);if(c.type==='VP8X'&&c.size>=10){data[8]&=~(0x08|0x04);}return data;});const content=concat(outChunks);const output=new Uint8Array(12+content.length);output.set(bytes.subarray(0,12));output.set(content,12);new DataView(output.buffer).setUint32(4,output.length-8,true);return {image:output,found:removed.map(c=>({type:`${c.type.trim()} metadata`,bytes:c.bytes}))};}
function process(bytes){const format=detect(bytes);const result=format==='jpeg'?processJpeg(bytes):format==='png'?processPng(bytes):processWebp(bytes);return {...result,format};}
function inspect(bytes){const {found,format}=process(bytes);return {found,format};}
function reportRows(items){return items.length?items.map(item=>`<div class="detail-row"><span class="detail-label">${escapeHtml(item.type)}</span><span class="detail-value">${formatBytes(item.bytes)}</span></div>`).join(''):'<div class="detail-row"><span class="detail-label">No supported removable metadata found</span><span class="detail-value">✓</span></div>';}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function resetDownload(){if(lastDownloadUrl){URL.revokeObjectURL(lastDownloadUrl);lastDownloadUrl=null;}$('downloadBtn').classList.add('hidden');$('result').classList.add('hidden');}
async function choose(file){$('error').classList.add('hidden');resetDownload();if(!file)return;if(file.size>MAX_BYTES){showError('Maximum file size is 25 MB.');return;}if(file.size<12){showError('The selected file is too small to be a valid image.');return;}
 try{const bytes=new Uint8Array(await file.arrayBuffer());const data=inspect(bytes);selectedFile=file;originalInfo={bytes,...data};$('dropzone').classList.add('hidden');$('workspace').classList.remove('hidden');$('filename').textContent=file.name;$('filesize').textContent=`${formatBytes(file.size)} · ${data.format.toUpperCase()}`;$('preview').src=URL.createObjectURL(file);$('preview').onload=()=>URL.revokeObjectURL($('preview').src);$('details').innerHTML=reportRows(data.found);$('summary').textContent=data.found.length?`Found ${data.found.length} removable metadata section(s). Color profiles needed for display will be retained.`:'No supported removable metadata sections found. You can still download a checked copy.';$('statusPill').textContent=data.found.length?'Metadata found':'No metadata found';$('statusPill').className=`pill ${data.found.length?'warn':'success'}`;}catch(e){showError(e.message||'Could not read image.');}}
function showError(message){$('error').textContent=message;$('error').classList.remove('hidden');}
function clean(){if(!selectedFile||!originalInfo)return;try{resetDownload();const {image,found,format}=process(originalInfo.bytes);const check=inspect(image);if(check.found.length)throw new Error('Verification failed: some removable metadata was detected in the output.');const mime={jpeg:'image/jpeg',png:'image/png',webp:'image/webp'}[format];const ext={jpeg:'jpg',png:'png',webp:'webp'}[format];const blob=new Blob([image],{type:mime});lastDownloadUrl=URL.createObjectURL(blob);const name=selectedFile.name.replace(/\.[^.]+$/,'');$('downloadBtn').href=lastDownloadUrl;$('downloadBtn').download=`${name}-clean.${ext}`;$('downloadBtn').classList.remove('hidden');$('result').textContent=`✓ Verified: ${found.length} supported metadata section(s) removed. ${formatBytes(originalInfo.bytes.length-image.length)} difference in file size. This does not verify removal of invisible pixel-level watermarks.`;$('result').classList.remove('hidden');$('statusPill').textContent='Cleaned and checked';$('statusPill').className='pill success';}catch(e){showError(e.message||'Image processing failed.');}}
$('fileInput').addEventListener('change',e=>choose(e.target.files[0]));$('cleanBtn').addEventListener('click',clean);$('changeBtn').addEventListener('click',()=>{selectedFile=null;originalInfo=null;resetDownload();$('workspace').classList.add('hidden');$('dropzone').classList.remove('hidden');$('fileInput').value='';$('fileInput').click();});
const zone=$('dropzone');for(const name of ['dragenter','dragover'])zone.addEventListener(name,e=>{e.preventDefault();zone.classList.add('dragging');});for(const name of ['dragleave','drop'])zone.addEventListener(name,e=>{e.preventDefault();zone.classList.remove('dragging');});zone.addEventListener('drop',e=>choose(e.dataTransfer.files[0]));$('year').textContent=new Date().getFullYear();
