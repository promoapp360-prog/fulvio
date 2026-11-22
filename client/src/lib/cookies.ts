export type CookieConfig={version:string;providers:{ga4:boolean;gtm:boolean;meta:boolean};reviewed:boolean;analytics:boolean;marketing:boolean;externalContent:boolean};
export type CookieConsent={necessary:true;analytics:boolean;marketing:boolean;externalContent:boolean;date:string;version:string;receiptId:string};
export const COOKIE_KEY="dp-cookie-consent";
export function readCookieChoice():CookieConsent|null{
  try{
    const value=JSON.parse(localStorage.getItem(COOKIE_KEY)||"null");
    if(!value||value.necessary!==true||typeof value.version!=="string"||typeof value.receiptId!=="string"||
      typeof value.analytics!=="boolean"||typeof value.marketing!=="boolean"||typeof value.externalContent!=="boolean")return null;
    const time=new Date(value.date),expiry=new Date(value.date);expiry.setMonth(expiry.getMonth()+6);
    if(!Number.isFinite(time.getTime())||time.getTime()>Date.now()+60_000||expiry.getTime()<=Date.now())return null;
    return value;
  }catch{return null;}
}
export function removeOptionalCookies(){
  for(const cookie of document.cookie.split(";")){
    const name=cookie.split("=")[0].trim();
    if(!/^(_ga(?:_|$)|_gid$|_gat(?:_|$)|_fbp$|_fbc$)/.test(name))continue;
    const hosts=location.hostname.split(".");
    const domains=["",...hosts.map((_,i)=>`.${hosts.slice(i).join(".")}`)];
    for(const domain of domains)document.cookie=`${name}=; Max-Age=0; Path=/; SameSite=Lax${domain?`; Domain=${domain}`:""}`;
  }
}
