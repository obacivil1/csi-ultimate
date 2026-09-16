const rx = /\+\d{1,3}[\s().-]*\d{1,4}[\s().-]*\d{1,4}[\s().-]*\d{2,10}/g;
const s = "Call +971501234567 or +966 55 123 4567 or 0501234567";
console.log(JSON.stringify([...s.matchAll(rx)].map((m) => m[0])));
console.log("simple:", /\+\d{1,3}\d{8,12}/.test("+971501234567"));