export const failureFeedback = (specificError: string): string =>
  `${specificError} The correct command and full explanation will be shown when the round ends.`;

export const mayRevealAnswers = (timerReachedZero: boolean): boolean => timerReachedZero;
