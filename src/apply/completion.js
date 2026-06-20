export function isSubmissionConfirmed(pageState) {
  const text = String(pageState?.pageText || '').replace(/\s+/g, ' ').trim();
  const url = String(pageState?.url || '');
  const hasSubmitButton = (pageState?.buttons || []).some(button =>
    !button.disabled && /^(?:submit|submit application|submit my application)$/i.test(String(button.text || '').trim())
  );

  const textConfirmsSubmission = [
    /thank you for (?:applying|your application)/i,
    /your application (?:has been|was) (?:successfully )?(?:submitted|received)/i,
    /we(?:'ve| have) received your application/i,
    /application (?:has been|was) successfully submitted/i,
    /submission (?:is )?(?:confirmed|complete|successful)/i,
  ].some(pattern => pattern.test(text));

  const confirmationUrl = /(?:application[-_/]?)?(?:submitted|confirmation|thank[-_]?you)(?:[/?#]|$)/i.test(url);
  return textConfirmsSubmission || (confirmationUrl && !hasSubmitButton);
}
