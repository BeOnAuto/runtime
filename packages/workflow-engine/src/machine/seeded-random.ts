const golden = 0x9e_37_79_b9;

const twoToTheThirtyTwo = 4_294_967_296;

export function drawOf(seed: number, draw: number): number {
  const mixed = Math.imul(seed ^ Math.imul(draw + 1, golden), 0x85_eb_ca_6b);
  const shuffled = Math.imul(mixed ^ (mixed >>> 13), 0xc2_b2_ae_35);
  return ((shuffled ^ (shuffled >>> 16)) >>> 0) / twoToTheThirtyTwo;
}
