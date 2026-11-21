// Donne un nouveau code PIN à un administrateur qui a oublié le sien.
// À lancer sur l'ordinateur serveur : reinitialiser-pin-admin.bat (ou « npm run reset-pin »).
import { randomInt } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { q } from './db.js';
import { hashPin } from './auth.js';

const admins = q.all("SELECT id, name, active FROM users WHERE role = 'admin' ORDER BY active DESC, name COLLATE NOCASE");
if (!admins.length) {
  console.error("Aucun administrateur trouvé : le magasin n'est pas encore configuré.");
  process.exit(1);
}

let target = admins[0];
if (admins.length > 1) {
  admins.forEach((a, i) => console.log(`  ${i + 1}. ${a.name}${a.active ? '' : ' (désactivé)'}`));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const choice = Number(await rl.question("Numéro de l'administrateur : "));
  rl.close();
  target = admins[choice - 1];
  if (!target) {
    console.error("Choix invalide : rien n'a été modifié.");
    process.exit(1);
  }
}

const pin = String(randomInt(100000, 1000000));
q.run('UPDATE users SET pin_hash = ?, active = 1 WHERE id = ?', hashPin(pin), target.id);
q.run('DELETE FROM sessions WHERE user_id = ?', target.id);
console.log(`\nAdministrateur : ${target.name}\nNouveau code PIN : ${pin}\nChangez-le ensuite dans Paramètres › Mon code PIN.`);
