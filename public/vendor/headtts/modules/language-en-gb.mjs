import { Language as LanguageEnUs } from "./language-en-us.mjs";

/**
* @class British English language module (Jobhuntz addition, MIT like the rest
* of HeadTTS). Words are read from dictionaries/en-gb.txt, generated from
* misaki's British lexicon (Apache-2.0) in the phoneme set Kokoro's British
* voices (bf_*, bm_*) were trained on. A word the dictionary lacks falls back
* to the American letter rules; numbers are read the British way, with "and"
* after the hundreds ("one hundred and fifty").
*/
class Language extends LanguageEnUs {

  convertHundreds(num) {
    num = Number(num);
    if (num > 99) {
      const rest = num % 100;
      return this.ones[Math.floor(num / 100)] + " HUNDRED" + (rest ? " AND " + this.convertTens(rest) : " ");
    }
    return this.convertTens(num);
  }

  convertThousands(num) {
    num = Number(num);
    if (num >= 1000) {
      const rest = num % 1000;
      // "two thousand and five", "forty-five thousand three hundred"
      const tail = rest === 0 ? "" : rest < 100 ? " AND " + this.convertTens(rest) : " " + this.convertHundreds(rest);
      return this.convertHundreds(Math.floor(num / 1000)) + " THOUSAND" + tail;
    }
    return this.convertHundreds(num);
  }

}

export { Language };
