export default function generateName() {
  const givenNames = [
    'Butterscotch',
    'Blossom',
    'Seafoam',
    'Twilight',
    'Starlight',
    'Cinnamon',
    'Dandelion',
    'Petal',
    'Coconut',
    'Marzipan',
    'Peppermint',
    'Melody',
    'Sparkle',
    'Glitter',
    'Sunbeam',
    'Moonshine',
    'Whirl',
    'Thistle',
    'Rosy',
    'Dewdrop',
  ];
  const surNames = [
    'Dash',
    'Shine',
    'Glow',
    'Breeze',
    'Twist',
    'Fizz',
    'Sweets',
    'Blossom',
    'Flutter',
    'Chime',
    'Ripple',
    'Puff',
    'Dazzle',
    'Sparks',
    'Whistle',
    'Jelly',
    'Cake',
    'Trot',
    'Neigh',
    'Berry',
  ];
  return givenNames[Math.floor(Math.random() * givenNames.length)]
    + ' '
    + surNames[Math.floor(Math.random() * surNames.length)];
}
