// Each category is a list of well-known IPs (intellectual properties).
// Two are drawn at random each round to form a "crossover".
const CATEGORIES = {
  cartoons: {
    label: 'Cartoons',
    emoji: '📺',
    ips: [
      'The Simpsons', 'Scooby-Doo', 'Looney Tunes',
      'Avatar: The Last Airbender', 'Phineas and Ferb',
      'The Flintstones', 'The Jetsons', 'Bluey', 'Peppa Pig', 'Paw Patrol',
      'Teenage Mutant Ninja Turtles', 'The Powerpuff Girls',
      'Recess', 'DuckTales', 'Garfield', 'Arthur',
      'Pokémon', 'Winnie the Pooh', 'Curious George', 'Peanuts',
      'Inspector Gadget', 'Animaniacs',
    ],
  },
  movies: {
    label: 'Movies',
    emoji: '🎬',
    ips: [
      'Jaws', 'Titanic', 'The Wizard of Oz', 'Home Alone', 'Jurassic Park', 'Toy Story',
      'Back to the Future', 'Rocky', 'Top Gun', 'Ghostbusters', 'Shrek',
      'Mean Girls', 'The Lion King', 'Frozen', 'Indiana Jones', 'Mission: Impossible',
      'Finding Nemo', 'The Princess Bride', 'Elf', 'Grease', 'Barbie',
      'Fast & Furious', 'Pirates of the Caribbean', 'October Sky',
      'The Sound of Music', 'Ratatouille', 'Night at the Museum', 'Cars', 'Mamma Mia!',
      'Willy Wonka', 'Jumanji', 'A Knight\'s Tale', 'Kung Fu Panda', 'Star Wars',
      'The Lord of the Rings', 'James Bond', 'Harry Potter', 'High School Musical',
    ],
  },
  tv: {
    label: 'TV Shows',
    emoji: '🛋️',
    ips: [
      'Friends', 'The Office', 'Seinfeld', 'Breaking Bad', 'Game of Thrones', 'Stranger Things',
      'The Great British Bake Off', 'Survivor', 'Jeopardy!', 'Wheel of Fortune',
      'Law & Order', 'Grey\'s Anatomy', 'Parks and Recreation', 'Schitt\'s Creek',
      'Ted Lasso', 'The Bachelor', 'Shark Tank', 'Downton Abbey',
      'Brooklyn Nine-Nine', 'The Price Is Right',
      'Mister Rogers Neighborhood', 'Sesame Street', 'Gilmore Girls',
      'Bridgerton', 'The Mandalorian', 'Antiques Roadshow', 'Andor',
      'The Good Place', 'NCIS', '24', 'Psych',
    ],
  },
  scifi: {
    label: 'Sci-Fi',
    emoji: '🚀',
    ips: [
      'Star Wars', 'Star Trek', 'Doctor Who', 'The Matrix', 'Alien', 'The Terminator',
      'Dune', 'E.T. the Extra-Terrestrial', 'Back to the Future', 'Jurassic Park',
      'The Hitchhiker\'s Guide to the Galaxy',
      'Men in Black', 'Independence Day', 'Avatar', 'WALL-E', 'Godzilla',
      'Planet of the Apes', 'The X-Files', 'Firefly', 'Ghostbusters', 'Transformers',
      'The Martian', 'Guardians of the Galaxy',
      '2001: A Space Odyssey', 'RoboCop', 'Lilo & Stitch', 'The Jetsons', 'Ender\'s Game',
      'Project Hail Mary', 'Star Fox', 'Mass Effect',
    ],
  },
  fantasy: {
    label: 'Fantasy',
    emoji: '🐉',
    ips: [
      'The Lord of the Rings', 'Harry Potter', 'The Chronicles of Narnia', 'Game of Thrones',
      'The Wizard of Oz', 'Alice in Wonderland', 'Peter Pan', 'The Hobbit', 'Shrek',
      'How to Train Your Dragon', 'The Legend of Zelda', 'Dungeons & Dragons', 'The Princess Bride',
      'Percy Jackson', 'Wicked', 'Frozen',
      'Sleeping Beauty', 'Beauty and the Beast', 'Aladdin', 'The Little Mermaid', 'Merlin',
      'The Witcher', 'Spirited Away', 'Pirates of the Caribbean', 'Encanto', 'Moana',
      'Mary Poppins', 'Hercules', 'A Wrinkle in Time', 'Brave',
    ],
  },
  videogames: {
    label: 'Video Games',
    emoji: '🎮',
    ips: [
      'Super Mario Bros.', 'The Legend of Zelda', 'Pokémon', 'Minecraft', 'Fortnite', 'Tetris',
      'Pac-Man', 'Sonic the Hedgehog', 'Animal Crossing', 'Halo', 'The Sims', 'Street Fighter',
      'Mario Kart', 'Donkey Kong', 'Kirby', 'Among Us', 'Angry Birds', 'Candy Crush',
      'Frogger', 'Space Invaders', 'Portal', 'Splatoon', 'Final Fantasy',
      'Overwatch', 'Guitar Hero', 'Just Dance', 'Wii Sports',
      'Oregon Trail', 'Duck Hunt', 'Stardew Valley', 'Grand Theft Auto',
    ],
  },
  superheroes: {
    label: 'Superheroes',
    emoji: '🦸',
    ips: [
      'Batman', 'Superman', 'Spider-Man', 'Wonder Woman', 'The Avengers', 'X-Men',
      'The Incredibles', 'Iron Man', 'Captain America', 'The Hulk', 'Thor', 'Black Panther',
      'The Flash', 'Aquaman', 'Guardians of the Galaxy', 'Fantastic Four',
      'Teen Titans', 'Ant-Man', 'Doctor Strange', 'Green Lantern', 'Captain Marvel',
      'Big Hero 6', 'Megamind', 'Shazam!', 'Wolverine', 'Justice League',
      'The Powerpuff Girls', 'Darkwing Duck', 'Supergirl', 'Batgirl',
    ],
  },
};

// "Everything" mixes every category together.
CATEGORIES.everything = {
  label: 'Everything',
  emoji: '🎲',
  ips: [...new Set(Object.values(CATEGORIES).flatMap((c) => c.ips))],
};

// "Custom" has no built-in list: the host types in their own items for the game.
const CUSTOM = { id: 'custom', label: 'Custom', emoji: '✏️' };

function listCategories() {
  return [
    ...Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.label, emoji: c.emoji })),
    CUSTOM,
  ];
}

module.exports = { CATEGORIES, CUSTOM, listCategories };
