export type CloudStyle='gentle'|'stratus'|'cumulus'|'faceted';
export interface CloudProfile {
 frequency:number;detail:number;latitudeScale:number;
 edge:number;variation:number;lower:number;upper:number;
 lift:number;base:number;gain:number;relief:number;
 normal:number;light:number;shade:number;optical:number;faceting:number;
}
const gentle:CloudProfile={frequency:3.8,detail:.10,latitudeScale:1,edge:.025,variation:.14,lower:.04,upper:.07,lift:.24,base:.06,gain:.30,relief:.72,normal:.55,light:.83,shade:.02,optical:12,faceting:.08};
/** Presentation profiles share the same simulation stocks and envelope topology. */
export const CLOUD_PROFILES:Record<CloudStyle,CloudProfile>={
 gentle,
 stratus:{...gentle,frequency:2.8,detail:0,latitudeScale:.48,variation:.08,lower:.03,upper:.07,lift:.22,base:.035,gain:.12,relief:.9,normal:.25,light:.91,shade:0,optical:4.5,faceting:0},
 cumulus:{...gentle,frequency:3.4,detail:0,edge:.04,variation:.15,lower:.035,upper:.065,lift:.24,base:.10,gain:.85,relief:.42,normal:.8,light:.78,shade:.02,optical:16,faceting:0},
 faceted:{...gentle,frequency:3.4,detail:0,edge:.06,variation:.16,lower:.015,upper:.035,base:.025,gain:.05,relief:.9,normal:.25,light:.96,shade:0,optical:24,faceting:.85},
};
