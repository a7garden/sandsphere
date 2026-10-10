/** Physical sampling owns its stream; decorative particles cannot consume it. */
export class SimulationRandom {
  constructor(private value=0x53a9d31){if(!value)this.value=1;}
  next(){let x=this.value;x^=x<<13;x^=x>>>17;x^=x<<5;this.value=x>>>0;return this.value/4294967296;}
}
