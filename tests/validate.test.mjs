import { test } from "node:test";
import assert from "node:assert/strict";
import { verhoeffValid, isAadhaar, validatePilgrim, validateContact } from "../shared/validate.js";

test("verhoeff accepts a number with a correct check digit", () => {
  // 236 → check digit 3 (standard worked example from the algorithm's description)
  assert.equal(verhoeffValid("2363"), true);
  assert.equal(verhoeffValid("2364"), false);
  assert.equal(verhoeffValid("12ab"), false);
});

test("isAadhaar needs 12 digits and a valid checksum", () => {
  assert.equal(isAadhaar("123456789012"), false);
  // Build a valid number by trying check digits for a fixed 11-digit prefix.
  const prefix = "99991234567";
  const valid = [..."0123456789"].map((d) => prefix + d).find(verhoeffValid);
  assert.ok(valid);
  assert.equal(isAadhaar(valid), true);
  assert.equal(isAadhaar(valid.slice(0, 11)), false);
});

test("validatePilgrim normalises and reports field errors", () => {
  const bad = validatePilgrim({ name: "  A ", age: "0", gender: "x", idType: "Aadhaar Card", idNumber: "1" });
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ["age", "gender", "idNumber", "name"]);

  const prefix = "99991234567";
  const aadhaar = [..."0123456789"].map((d) => prefix + d).find(verhoeffValid);
  const good = validatePilgrim({ name: " Rama  Krishna ", age: " 34", gender: "Male", idType: "Aadhaar Card", idNumber: aadhaar });
  assert.equal(good.ok, true, JSON.stringify(good.errors));
  assert.equal(good.value.name, "Rama Krishna");
  assert.equal(good.value.selected, true);

  const passport = validatePilgrim({ name: "Sita", age: "30", gender: "Female", idType: "Passport", idNumber: "N1234567" });
  assert.equal(passport.ok, true);
});

test("validateContact treats fields as optional but checks filled ones", () => {
  assert.equal(validateContact({}).ok, true);
  const r = validateContact({ email: "nope", city: "Tirupati", pincode: "012345" });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ["email", "pincode"]);
  assert.equal(validateContact({ email: "a.b@example.in", pincode: "517501", state: "Andhra Pradesh" }).ok, true);
});
