import { describe, expect, it } from "vitest";
import { amountInWords, numberToWordsIndian, rupeesInWords, yearsInWords } from "../numberToWords";

describe("numberToWordsIndian", () => {
  it("reads small numbers", () => {
    expect(numberToWordsIndian(0)).toBe("Zero");
    expect(numberToWordsIndian(5)).toBe("Five");
    expect(numberToWordsIndian(19)).toBe("Nineteen");
    expect(numberToWordsIndian(20)).toBe("Twenty");
    expect(numberToWordsIndian(42)).toBe("Forty Two");
    expect(numberToWordsIndian(100)).toBe("One Hundred");
    expect(numberToWordsIndian(101)).toBe("One Hundred One");
    expect(numberToWordsIndian(1005)).toBe("One Thousand Five");
  });

  it("groups as thousand / lakh / crore (not million)", () => {
    expect(numberToWordsIndian(6155)).toBe("Six Thousand One Hundred Fifty Five");
    expect(numberToWordsIndian(100000)).toBe("One Lakh");
    expect(numberToWordsIndian(280000)).toBe("Two Lakh Eighty Thousand");
    expect(numberToWordsIndian(10000000)).toBe("One Crore");
    expect(numberToWordsIndian(123456789)).toBe("Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine");
    expect(numberToWordsIndian(999999999)).toBe("Ninety Nine Crore Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine");
  });

  it("still reads 100 crore and more", () => {
    expect(numberToWordsIndian(1000000000)).toBe("One Hundred Crore");
    expect(numberToWordsIndian(12345000000)).toBe("One Thousand Two Hundred Thirty Four Crore Fifty Lakh");
  });

  it("drops the paise and says Minus for a negative number", () => {
    expect(numberToWordsIndian(6155.99)).toBe("Six Thousand One Hundred Fifty Five");
    expect(numberToWordsIndian(-5)).toBe("Minus Five");
  });

  it("is empty for a non-finite value", () => {
    expect(numberToWordsIndian(NaN)).toBe("");
    expect(numberToWordsIndian(Infinity)).toBe("");
  });
});

describe("amountInWords", () => {
  it("gives whole rupees in words, with no suffix", () => {
    expect(amountInWords(280000)).toBe("Two Lakh Eighty Thousand");
    expect(amountInWords(6155.9)).toBe("Six Thousand One Hundred Fifty Five");
    expect(amountInWords(10000000)).toBe("One Crore");
  });

  it("is empty for zero, a negative amount or not a number", () => {
    expect(amountInWords(0)).toBe("");
    expect(amountInWords(-5)).toBe("");
    expect(amountInWords(NaN)).toBe("");
    expect(amountInWords(Infinity)).toBe("");
  });
});

describe("rupeesInWords", () => {
  it("adds 'Rupees Only'", () => {
    expect(rupeesInWords(280000)).toBe("Two Lakh Eighty Thousand Rupees Only");
    expect(rupeesInWords(0)).toBe("Zero Rupees Only");
  });

  it("reads the paise", () => {
    expect(rupeesInWords(174139.2)).toBe("One Lakh Seventy Four Thousand One Hundred Thirty Nine Rupees and Twenty Paise Only");
    expect(rupeesInWords(0.5)).toBe("Zero Rupees and Fifty Paise Only");
    expect(rupeesInWords(10.05)).toBe("Ten Rupees and Five Paise Only");
  });

  it("says Minus for a negative amount", () => {
    expect(rupeesInWords(-500)).toBe("Minus Five Hundred Rupees Only");
    expect(rupeesInWords(-500.5)).toBe("Minus Five Hundred Rupees and Fifty Paise Only");
  });

  it("is empty for a missing or non-number amount", () => {
    expect(rupeesInWords(null)).toBe("");
    expect(rupeesInWords(undefined)).toBe("");
    expect(rupeesInWords(NaN)).toBe("");
  });
});

describe("yearsInWords", () => {
  it("says year for one and years otherwise", () => {
    expect(yearsInWords(1)).toBe("One year");
    expect(yearsInWords(5)).toBe("Five years");
    expect(yearsInWords(0)).toBe("Zero years");
    expect(yearsInWords(2.7)).toBe("Two years");
  });

  it("is empty for a missing or non-number value", () => {
    expect(yearsInWords(null)).toBe("");
    expect(yearsInWords(undefined)).toBe("");
    expect(yearsInWords(NaN)).toBe("");
  });
});
