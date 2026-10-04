window.IHKApi = (()=>{
  const cfg=()=>window.IHK_CONFIG||{};
  const configured=()=>cfg().API_URL && !cfg().API_URL.includes('PASTE_YOUR');
  async function call(action,payload={}){
    if(!configured()) throw new Error('API_URL belum dikonfigurasi');
    const res=await fetch(cfg().API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,...payload})});
    const data=await res.json();
    if(data?.ok===false) throw new Error(data.error||'Backend error');
    return data;
  }
  async function dashboard(){if(!configured()) return null;try{return await call('dashboard');}catch(e){console.warn(e);return null}}
  async function saveAudit(record){if(!configured()) return {offline:true};return call('saveAudit',{record})}
  async function list(type){if(!configured()) return null;return call('list',{type})}
  return {configured,call,dashboard,saveAudit,list};
})();
