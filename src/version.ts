import {version} from '../package.json';

export const APP_VERSION=version;
export const APP_VERSION_LABEL=version.replace(/-(alpha|beta)\.(\d+)$/,(_,stage:string,number:string)=>
  ` ${stage[0].toUpperCase()+stage.slice(1)} ${number}`);
