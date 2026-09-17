/** Match backend validate_password: Unicode scalar count, Alphabetic and Number. */
export function passwordValidationCode(password: string): string | undefined {
  const length = [...password].length
  if (length < 8) return 'password_too_short'
  if (length > 128) return 'password_too_long'
  if (!/\p{Alphabetic}/u.test(password) || !/\p{Number}/u.test(password)) {
    return 'password_needs_letter_and_digit'
  }
  return undefined
}
