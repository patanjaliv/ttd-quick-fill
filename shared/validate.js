// Pure validation helpers shared by the popup and the unit tests.
// Rules mirror what the TTD booking forms themselves accept, so a value that
// passes here should not be rejected by the site.

export const GENDERS = ["Male", "Female", "Transgender"];
export const ID_TYPES = ["Aadhaar Card", "Passport"];

const NAME_RE = /^[A-Za-z][A-Za-z ]{1,79}$/;
const PASSPORT_RE = /^[A-Za-z0-9]{6,12}$/;
const EMAIL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const PLACE_RE = /^[A-Za-z][A-Za-z .&-]{1,49}$/;
const PIN_RE = /^[1-9][0-9]{5}$/;

// Verhoeff checksum, the check digit scheme used by Aadhaar numbers.
const MUL = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const PERM = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function verhoeffValid(digits) {
  if (!/^\d+$/.test(digits)) return false;
  let check = 0;
  const reversed = digits.split("").reverse();
  for (let i = 0; i < reversed.length; i++) {
    check = MUL[check][PERM[i % 8][Number(reversed[i])]];
  }
  return check === 0;
}

export function isAadhaar(value) {
  return /^\d{12}$/.test(value) && verhoeffValid(value);
}

const clean = (v) => String(v ?? "").trim().replace(/\s+/g, " ");

/** Returns { ok, value, errors } where value is the normalised pilgrim. */
export function validatePilgrim(input) {
  const errors = {};
  const value = {
    id: input?.id || "",
    name: clean(input?.name),
    age: clean(input?.age),
    gender: clean(input?.gender),
    idType: clean(input?.idType) || "Aadhaar Card",
    idNumber: clean(input?.idNumber).replace(/ /g, ""),
    selected: input?.selected !== false,
  };
  if (!NAME_RE.test(value.name)) errors.name = "Name: 2–80 English letters and spaces.";
  if (!/^\d{1,3}$/.test(value.age) || Number(value.age) < 1 || Number(value.age) > 120) errors.age = "Age: a number from 1 to 120.";
  if (!GENDERS.includes(value.gender)) errors.gender = "Choose a gender.";
  if (!ID_TYPES.includes(value.idType)) errors.idType = "Choose an ID type.";
  if (value.idType === "Aadhaar Card") {
    if (!/^\d{12}$/.test(value.idNumber)) errors.idNumber = "Aadhaar: exactly 12 digits.";
    else if (!verhoeffValid(value.idNumber)) errors.idNumber = "Aadhaar: the check digit does not match. Re-check the number.";
  } else if (!PASSPORT_RE.test(value.idNumber)) {
    errors.idNumber = "Passport: 6–12 letters or digits.";
  }
  return { ok: Object.keys(errors).length === 0, value, errors };
}

/** Contact fields are optional, but a filled-in field must be valid. */
export function validateContact(input) {
  const errors = {};
  const value = {
    email: clean(input?.email),
    city: clean(input?.city),
    state: clean(input?.state),
    country: clean(input?.country),
    pincode: clean(input?.pincode).replace(/ /g, ""),
  };
  if (value.email && !EMAIL_RE.test(value.email)) errors.email = "Enter a valid email address.";
  for (const key of ["city", "state", "country"]) {
    if (value[key] && !PLACE_RE.test(value[key])) errors[key] = "Letters, spaces and . & - only.";
  }
  if (value.pincode && !PIN_RE.test(value.pincode)) errors.pincode = "PIN code: 6 digits, not starting with 0.";
  return { ok: Object.keys(errors).length === 0, value, errors };
}
