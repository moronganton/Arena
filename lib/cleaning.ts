// Default cleaning checklist used when a property has no custom items.
export interface ChecklistEntry {
  category: string;
  label: string;
  done: boolean;
}

export const DEFAULT_CHECKLIST: Array<{ category: string; label: string }> = [
  // Bedroom
  { category: "Bedroom", label: "Change bed linens and pillowcases" },
  { category: "Bedroom", label: "Make beds" },
  { category: "Bedroom", label: "Dust surfaces and wipe furniture" },
  { category: "Bedroom", label: "Check wardrobe for left-behind items" },

  // Bathroom
  { category: "Bathroom", label: "Replace towels (bath + hand)" },
  { category: "Bathroom", label: "Refill toilet paper (min. 2 rolls)" },
  { category: "Bathroom", label: "Refill soap and shampoo" },
  { category: "Bathroom", label: "Clean shower, toilet and sink" },
  { category: "Bathroom", label: "Clean mirror" },

  // Kitchen
  { category: "Kitchen", label: "Wash and put away dishes" },
  { category: "Kitchen", label: "Refill coffee" },
  { category: "Kitchen", label: "Refill milk, sugar and tea" },
  { category: "Kitchen", label: "Empty fridge of guest items" },
  { category: "Kitchen", label: "Wipe counters and stove" },
  { category: "Kitchen", label: "Take out trash and add new bags" },

  // Living area
  { category: "Living Area", label: "Vacuum and mop all floors" },
  { category: "Living Area", label: "Check TV remote batteries" },
  { category: "Living Area", label: "Test air conditioning / heating" },
  { category: "Living Area", label: "Clean windows and surfaces" },

  // Final checks
  { category: "Final Checks", label: "Restock bottled water" },
  { category: "Final Checks", label: "Check all lights work" },
  { category: "Final Checks", label: "Close all windows" },
  { category: "Final Checks", label: "Set AC/heating to standard temperature" },
  { category: "Final Checks", label: "Lock door and confirm lock works" },
];
