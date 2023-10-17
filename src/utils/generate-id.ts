// const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const characters =
  "y4FKMvJhR02Q8gLG7l1rOjH9oXTdpBbPWZfnexzmaSNcwCtsDqUui6AEk3V5yI";
const charLength = characters.length;

export function generateRandomId() {
  let randomId = "";
  let i = 0;
  for (; i < 36; ++i) {
    randomId += characters.charAt(Math.floor(Math.random() * charLength));
  }
  return randomId;
}
