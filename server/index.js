// Point d'entrée : vérifie la version de Node.js puis démarre le serveur.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(
    `\n  Votre version de Node.js (${process.versions.node}) est trop ancienne.\n` +
      '  Installez la version LTS de Node.js (22.13 ou plus récente) depuis https://nodejs.org\n',
  );
  process.exit(1);
}

await import('./app.js');
