SAMA ÉCOLE VIRTUELLE
=====================

Architecture
------------
Ce projet n'utilise PAS Google Sheets ni SheetDB.
La persistance est faite avec Netlify Functions + Netlify Blobs.

Fonctionnalités
---------------
- Candidature publique
- WhatsApp obligatoire
- Ordinateur + bonne connexion Wi-Fi obligatoires
- L'administrateur choisit matière + classe
- Un seul site, avec accès #admin
- Mot de passe par défaut : sama2026
- Acceptation / refus / suppression des candidatures
- Modification / suppression / création des recrutements
- Données partagées entre les appareils
- Notifications internes dans l'administration
- Notifications navigateur lorsque le tableau admin est ouvert
- Intégration Netlify Forms pour pouvoir recevoir des e-mails sur une candidature

Déploiement recommandé
----------------------
1. Importer le dossier dans un dépôt GitHub depuis un téléphone.
2. Dans Netlify : Add new project -> Import an existing project -> GitHub.
3. Sélectionner le dépôt puis publier.
4. Netlify construira et déploiera automatiquement la Function située dans netlify/functions/api.mjs.
5. Dans Netlify, pour une sécurité renforcée, définir :
   ADMIN_PASSWORD = votre nouveau mot de passe
   SESSION_SECRET = une longue chaîne secrète aléatoire

Le mot de passe demandé par le projet est actuellement "sama2026".
La version serveur utilise ce mot de passe par défaut, mais il est préférable de le remplacer
dans les variables d'environnement Netlify après la première mise en ligne.

Notifications e-mail
--------------------
Le formulaire "candidature-netlify" est inclus pour que Netlify Forms puisse recevoir les candidatures.
Dans le tableau de bord Netlify, ouvrir la gestion des Forms puis créer une notification e-mail
pour le formulaire "candidature-netlify".

Test
----
- Ouvrir l'accueil.
- Ajouter un recrutement depuis #admin.
- Revenir à l'accueil : la matière/classe doit apparaître.
- Envoyer une candidature.
- Retourner à #admin : la candidature doit apparaître.
- Tester Accepter, Refuser, Modifier et Supprimer.
- Ouvrir le même site sur un autre téléphone : les données doivent être identiques.

Sécurité
--------
L'authentification admin se fait côté serveur par Cookie HttpOnly, et non par un mot de passe
simplement caché dans le HTML. Le mot de passe par défaut est toutefois connu puisque demandé
dans le cahier des charges ; il est recommandé de le changer avec ADMIN_PASSWORD.
