export function isValidEmail(email) {
  return typeof email === 'string' && /.+@/.test(email);
}
