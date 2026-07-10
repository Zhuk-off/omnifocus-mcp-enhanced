export function buildAppleScriptJsonHelpers(): string {
  return `
on jsonEscape(inputText)
  if inputText is missing value then
    return ""
  end if

  set inputText to inputText as text
  set inputText to my replaceText("\\\\", "\\\\\\\\", inputText)
  set inputText to my replaceText("\\"", "\\\\\\"", inputText)
  set inputText to my replaceText(return, "\\\\n", inputText)
  set inputText to my replaceText(linefeed, "\\\\n", inputText)
  set inputText to my replaceText(tab, "\\\\t", inputText)
  -- Escape remaining JSON-illegal control chars (U+0000-08, 0B, 0C, 0E-1F) as \\u00XX.
  -- Left raw, they make Node's JSON.parse throw, so a successful OmniFocus write
  -- would be reported as a failure (and retried, creating duplicates).
  repeat with cc in {0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31}
    set n to cc as integer
    set inputText to my replaceText((character id n), "\\\\u00" & my toHex2(n), inputText)
  end repeat
  return inputText
end jsonEscape

on toHex2(n)
  set hexChars to "0123456789abcdef"
  return (character ((n div 16) + 1) of hexChars) & (character ((n mod 16) + 1) of hexChars)
end toHex2

on replaceText(findText, replacementText, subjectText)
  set previousTextItemDelimiters to AppleScript's text item delimiters
  set AppleScript's text item delimiters to findText
  set subjectItems to text items of (subjectText as text)
  set AppleScript's text item delimiters to replacementText
  set updatedText to subjectItems as text
  set AppleScript's text item delimiters to previousTextItemDelimiters
  return updatedText
end replaceText
`;
}
