export const parseRawAddress = (rawText: string) => {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  
  let name = '';
  let phone = '';
  let address = '';

  const phoneRegex = /[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}/im;

  lines.forEach(line => {
    if (phoneRegex.test(line)) {
      phone = line;
    } else if (!name) {
      name = line;
    } else {
      address += address ? ', ' + line : line;
    }
  });

  return { name, phone, address };
};
