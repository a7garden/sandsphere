import type {Material} from '../sim/model';
/** Acquisition rules describe the existing solver and campaign, not invented recipes. */
export const MATERIAL_SOURCES:Record<Material,string>={
 sand:'기본 공급 · 무제한. 유리의 원료이며 식생이 뿌리내릴 수 있는 지표를 만듭니다.',
 water:'기본 공급 · 무제한. 냉각하면 얼음, 증발하면 수증기, 응결하면 구름이 됩니다.',
 clay:'기본 공급 · 무제한. 물을 말리고 850°C 이상에서 행성 시간 30분 동안 구우면 도자기가 됩니다.',
 salt:'기본 공급 · 무제한. 녹은 소금도 물이 증발하면 다시 결정으로 남습니다.',
 oxygen:'기본 공급 · 무제한. 광합성으로도 생깁니다. 메탄·유기물과 섞고 가열해 연소를 관찰하세요.',
 nitrogen:'기본 공급 · 무제한. 기체는 대기에 공급되며 회수 도구로 모을 수 없습니다.',
 methane:'기본 공급 · 무제한. 기체는 대기에 공급되며 회수 도구로 모을 수 없습니다.',
 carbonDioxide:'기본 공급 · 무제한. 대기에 공급하며 식생의 탄소원으로 사용됩니다.',
 soil:'기본 공급 · 무제한. 생물의 잔해로도 생기며 물을 붙잡고 식생의 성장 재료가 됩니다.',
 ice:'물을 어는점 아래로 냉각하거나 얼음 행성에서 회수하세요. 소금이 녹아 있으면 더 낮은 온도가 필요합니다.',
 ceramic:'점토를 말리고 850°C 이상에서 행성 시간 30분 동안 가열한 뒤 회수하세요. 재생 중에만 소성이 진행됩니다.',
 glass:'모래를 1,700°C보다 높게 가열하고, 녹은 규사를 1,400°C 아래로 식힌 뒤 회수하세요.',
 plant:'시작 표본 8kg. 모래·점토·유기물 위에서 빛과 수분을 유지하며 키우고 회수하세요. 모두 소진하면 표본을 다시 받을 수 있습니다.',
 herbivore:'첫 정원 완료 보상 4kg. 식생 옆의 촉촉한 육지에서 키우고 회수하세요. 고인 물에 공급하면 죽습니다.',
 carnivore:'먹이의 연결 완료 보상 1kg. 초식 생물 옆의 육지에 소량 공급하고 회수하세요. 고인 물에 공급하면 죽습니다.',
 iron:'운석 도구로 충돌시키면 운철 36kg이 공급됩니다. 충돌 지점에서 회수 도구로 모으세요.',
};
export function formatSupplyMass(value:number){
 if(value>0&&value<.001)return '<0.001 kg';
 return value.toFixed(value>0&&value<.1?3:value>0&&value<1?2:1)+' kg';
}
