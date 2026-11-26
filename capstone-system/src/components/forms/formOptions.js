// Choices on the Job Order Request form (FM-NBSC-GSO-004), in the paper
// form's order. Used by the printed form and the dashboard's edit window.

export const JOR_REQUEST_TYPES = [
  { value: 'repair', label: 'Repair' },
  { value: 'corrective_maintenance', label: 'Corrective Maintenance' },
  { value: 'emergency', label: 'Emergency Work Request' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'hauling', label: 'Hauling of Items' },
  { value: 'others', label: 'Others' },
];

export const JOR_NATURE_OF_WORK = [
  { value: 'easy', label: 'Easy (3 days)', days: 3 },
  { value: 'complex', label: 'Complex (7 days)', days: 7 },
  { value: 'highly_technical', label: 'Highly Technical (20 days)', days: 20 },
];
