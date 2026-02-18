const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
});

export const formatAiOutputLabel = (collapsed: boolean, generatedAt?: string | null) => {
  const action = collapsed ? 'Show' : 'Hide';
  if (!generatedAt) {
    return `${action} AI response`;
  }

  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) {
    return `${action} AI response`;
  }

  return `${action} AI response \u2022 ${DATE_TIME_FORMAT.format(date)}`;
};
