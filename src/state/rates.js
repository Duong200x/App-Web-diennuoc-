import { getNum, setNum, KEYS } from "./storage.js";
export const getRates = () => ({
  electricityRate: getNum(KEYS.rateE, 2800),
  waterRate:       getNum(KEYS.rateW, 10500)
});

export function setRates(e, w) {
  setNum(KEYS.rateE, Number(e));
  setNum(KEYS.rateW, Number(w));
}
