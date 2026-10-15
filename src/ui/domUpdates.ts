/** Preserve existing text nodes when the rendered value is unchanged. */
export function setTextIfChanged(node:Node,value:string){if(node.textContent===value)return false;node.textContent=value;return true;}
