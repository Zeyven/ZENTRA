const MAX_RESOURCES=10000,MAX_FRAGMENT_BYTES=64*1024;

function text(row,key,max=4096){const value=row?.[key];if(typeof value!=='string'||value.length>max)throw Error(`Invalid vendor menu ${key}`);return value}

export function parseVendorResources(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>4*1024*1024)throw Error('Invalid vendor menu cache');
 const value=JSON.parse(raw);if(!Array.isArray(value)||value.length>MAX_RESOURCES)throw Error('Invalid vendor menu resource list');
 return value.map(row=>({
  saasId:text(row,'saasId',255),parentId:text(row,'parentId',255),title:text(row,'title',255),
  sortOrder:text(row,'sortOrder',40),url:text(row,'url',MAX_FRAGMENT_BYTES)
 }));
}

// Reconstructed from GetThriftMenuContent in the supplied vendor executable:
// business root -> 7-inch child -> ordered action children.
export function selectPointClockMenuFragments(resources,businessType){
 if(!Array.isArray(resources)||!['BATH','FOOT'].includes(businessType))throw Error('Invalid point-clock menu input');
 const roots=resources.filter(row=>row.title.includes(businessType));if(roots.length!==1)throw Error(`Vendor ${businessType} menu root is missing or ambiguous`);
 const root=roots[0];if(!root.saasId?.trim())throw Error('Vendor point-clock menu root ID is missing');
 const panels=resources.filter(row=>row.parentId.includes(root.saasId)&&row.title.includes('7'));if(panels.length!==1)throw Error('Vendor 7-inch point-clock menu is missing or ambiguous');
 const panel=panels[0];if(!panel.saasId?.trim())throw Error('Vendor 7-inch point-clock menu ID is missing');
 const selected=resources.filter(row=>row.parentId.includes(panel.saasId)).map((row,index)=>{const order=Number.parseFloat(row.sortOrder);if(!Number.isFinite(order)||!row.url.trim())throw Error('Invalid vendor point-clock menu action');return {row,index,order}}).sort((a,b)=>a.order-b.order||a.index-b.index).map(x=>x.row.url);
 if(!selected.length)throw Error('Vendor point-clock menu has no actions');return selected;
}

export function buildPointClockMenuJson(fragments){
 if(!Array.isArray(fragments)||!fragments.length||fragments.length>256)throw Error('Invalid point-clock menu fragments');
 const parsed=fragments.map(fragment=>{if(typeof fragment!=='string'||Buffer.byteLength(fragment)>MAX_FRAGMENT_BYTES)throw Error('Invalid point-clock menu fragment');const value=JSON.parse(fragment);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid point-clock menu action');return value});
 return JSON.stringify(parsed);
}
