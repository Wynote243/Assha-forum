const express = require("express");
const mysql = require("mysql2");
const bcrypt = require("bcrypt");
const session = require("express-session");
const port = process.env.PORT || 5000;

const app = express();
const db = require("./config/db"); // ← ← ← OBLIGATOIRE


app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));


app.use(session({
  secret: "assha_secret_key",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24*60*60*1000 } // 1 jour
}));

app.use(express.json());
app.use("/uploads", express.static(__dirname + "/uploads"));

app.get("/api/posts", (req, res) => {
  const sql = `
    SELECT 
      p.id,
      p.texte,
      p.image,
      p.date_creation,
      u.prenom,
      (
        SELECT COUNT(*) 
        FROM likes l 
        WHERE l.id_post = p.id
      ) AS likes_count,
      (
        SELECT COUNT(*) 
        FROM comments c
        WHERE c.id_post = p.id
      ) AS comments_count
    FROM posts p
    LEFT JOIN users u ON u.id = p.id_users
    ORDER BY p.date_creation DESC
  `;

  db.query(sql, (err, posts) => {
    if (err) {
      console.error("Erreur récupération posts :", err);
      return res.json([]);
    }
    res.json(posts);
  });
});



app.post("/api/posts/:id/like", (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false });

  const postId = req.params.id;
  const userId = req.session.user.id;

  const sql = `INSERT IGNORE INTO likes (id_users, id_post) VALUES (?, ?)`;
  db.query(sql, [userId, postId], err => {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true });
  });
});



// Route pour ajouter un commentaire
app.post("/api/posts/:id/comment", (req, res) => {
  const postId = req.params.id;        // ID du post
  const user = req.session.user;       // Vérifier session

  // Vérifications de sécurité
  if (!user) return res.status(401).json({ success: false, error: "Utilisateur non connecté" });
  if (!postId) return res.status(400).json({ success: false, error: "ID du post manquant" });

  const texte = req.body.texte;
  if (!texte || texte.trim() === "") return res.status(400).json({ success: false, error: "Texte du commentaire manquant" });

  const sql = "INSERT INTO comments (id_users, id_post, texte, date_creation) VALUES (?, ?, ?, NOW())";
  db.query(sql, [user.id, postId, texte], (err, result) => {
    if (err) {
      console.error("Erreur insertion commentaire:", err);
      return res.status(500).json({ success: false, error: "Erreur serveur lors de l'ajout du commentaire" });
    }

    // Retour JSON pour mise à jour en temps réel
    res.json({
      success: true,
      comment: {
        id: result.insertId,
        id_post: postId,
        id_users: user.id,
        texte: texte,
        prenom: user.prenom,
        date_creation: new Date()
      }
    });
  });
});


// API pour récupérer les commentaires d'un post
app.get("/api/posts/:id/comments", (req, res) => {
  const postId = req.params.id;
  const sql = `
    SELECT c.id, c.texte, c.date_creation, u.prenom
    FROM comments c
    JOIN users u ON u.id = c.id_users
    WHERE c.id_post = ?
    ORDER BY c.date_creation ASC
  `;
  db.query(sql, [postId], (err, results) => {
    if (err) return res.status(500).json({ error: err });
    res.json(results);
  });
});





//app.get("/forum", (req, res) => {
   // console.log("SESSION FORUM =", req.session.user);

   // if (!req.session.user) {
       // return res.redirect("/login");
   // }

  //  return res.redirect("/forum");
//});

app.post("/login", (req, res) => {
  const { email, password } = req.body;

  // Vérification simple exemple
  const sql = "SELECT id, mot_de_passe FROM users WHERE email=?";
  db.query(sql, [email], (err, results) => {
    if (err) return res.json({ success: false, message: "Erreur serveur" });
    if (!results.length) return res.json({ success: false, message: "Email incorrect" });

    const user = results[0];
    if (password !== user.mot_de_passe) return res.json({ success: false, message: "Mot de passe incorrect" });

    req.session.user = { id: user.id, email };
    res.json({ success: true, redirect: "/forum" });
  });
});


app.post("/forum/new-topic", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const { title, content } = req.body;
  const userId = req.session.user.id; // l'id de l'utilisateur connecté

  if (!title || !content) {
    return res.send("Titre et message sont obligatoires.");
  }

  const sql = `
    INSERT INTO forum_topics (user_id, title, content, created_at, status)
    VALUES (?, ?, ?, NOW(), 'active')
  `;

  // Utilise db au lieu de connection
  db.query(sql, [userId, title, content], (err, results) => {
    if (err) {
      console.error(err);
      return res.send("Erreur lors de l'enregistrement du sujet.");
    }
    // Redirige vers la liste des sujets
    res.redirect("/forum/topics");
  });
});


// Récupérer tous les sujets actifs
app.get("/api/forum/topics", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Non autorisé" });

  const sql = `
    SELECT id, title, content, created_at
    FROM forum_topics
    WHERE status = 'active'
    ORDER BY created_at DESC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Erreur SQL:", err);
      return res.status(500).json({ error: "Erreur lors de la récupération des sujets" });
    }

    res.json(results); // on renvoie juste les données brutes
  });
});

app.get("/forum/delete-topic/:id", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const topicId = req.params.id;
  const userId = req.session.user.id;

  const sql = `DELETE FROM forum_topics WHERE id = ? AND user_id = ?`;

  db.query(sql, [topicId, userId], (err, result) => {
    if (err) {
      console.error(err);
      return res.send("Erreur lors de la suppression du sujet.");
    }
    res.redirect("/forum/my-topics");
  });
});


app.get("/forum/edit-topic/:id", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const topicId = req.params.id;
  const userId = req.session.user.id;

  const sql = `SELECT title, content FROM forum_topics WHERE id = ? AND user_id = ?`;

  db.query(sql, [topicId, userId], (err, results) => {
    if (err || results.length === 0) return res.send("Sujet introuvable ou non autorisé.");

    const topic = results[0];

    res.send(`
      <div class="container mt-4">
        <div class="section">
          <h2>Modifier le sujet</h2>
          <form action="/forum/edit-topic/${topicId}" method="POST">
            <label>Titre</label>
            <input name="title" class="form-control mb-2" value="${topic.title}" maxlength="150" required>
            <label>Message</label>
            <textarea name="content" class="form-control mb-2" required>${topic.content}</textarea>
            <button type="submit" class="btn btn-primary">Mettre à jour</button>
          </form>
        </div>
      </div>
    `);
  });
});

app.post("/forum/edit-topic/:id", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const topicId = req.params.id;
  const userId = req.session.user.id;
  const { title, content } = req.body;

  const sql = `UPDATE forum_topics SET title = ?, content = ? WHERE id = ? AND user_id = ?`;

  db.query(sql, [title, content, topicId, userId], (err) => {
    if (err) {
      console.error(err);
      return res.send("Erreur lors de la mise à jour.");
    }
    res.redirect("/forum/my-topics");
  });
});




app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/login");
    });
});




// -------------------- Route : Affichage tableau users --------------------
app.get("/", (req, res) => {
    let html = `
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Bienvenue — ASSHA</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            * { margin:0; padding:0; box-sizing:border-box; }
            body { font-family:'Arial', sans-serif; background:#f2f4f7; }

            /* Header fixe */
            header {
                position: fixed;
                top:0; left:0; right:0;
                height:60px;
                background:#0b57d0;
                display:flex;
                align-items:center;
                padding:0 20px;
                z-index:1000;
            }
            header img { height:40px; border-radius:8px; margin-right:10px; }
            header h1 { color:white; font-size:22px; margin:0; flex:1; }

            .hero { display:flex; justify-content:center; align-items:flex-start; width:100%; min-height:100vh; padding:100px 20px 20px; }
            .card { width:100%; max-width:480px; background:white; padding:35px 25px; border-radius:22px; box-shadow:0 12px 30px rgba(0,0,0,0.15); text-align:center; animation:fadeIn 0.7s ease-out; }
            @keyframes fadeIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
            .logo-img { width:100px; height:100px; border-radius:50%; object-fit:cover; margin:0 auto 20px; display:block; }
            h1 { font-size:28px; font-weight:bold; color:#0b57d0; margin-bottom:20px; }
            .center-image { width:100%; height:auto; border-radius:14px; margin:0 auto 25px; display:block; }
            .lang-box { margin-bottom:30px; font-size:16px; text-align:left; color:#555; }
            .lang-box label { display:block; margin-bottom:8px; font-weight:500; color:#555; line-height:1.4; }
            select { width:100%; padding:12px; font-size:16px; border-radius:10px; border:1px solid #ccc; margin-top:8px; }
            .btn { display:inline-block; width:100%; padding:15px 0; background:#0b57d0; color:white; text-decoration:none; font-size:18px; font-weight:bold; border-radius:10px; transition:0.3s; cursor:pointer; }
            .btn:hover { background:#0849ad; }
            @media (max-width:600px) { .card { padding:28px 20px; } h1 { font-size:24px; } }
        </style>
    </head>

    <body>

        <header>
            <img src="/img/log2.jpg" alt="ASSHA">
            <h1>ASSHA</h1>
        </header>

        <div class="hero">
            <div class="card">
                <!-- Logo -->
                <img src="/img/log2.jpg" class="logo-img" alt="Logo ASSHA">

                <h1 id="welcomeTitle">Bienvenue chez ASSHA</h1>

                <!-- Image caritative -->
                <img src="/img/atencion.jpg" class="center-image" alt="Action humanitaire">

                <!-- Sélecteur de langue -->
                <div class="lang-box">
                    <label id="langLabel">Choisissez votre langue et commencez avec nous la découverte de l’univers ASSHA — un monde d’entraide et de solidarité :</label>
                    <select id="lang">
                        <option value="fr">Français</option>
                        <option value="en">English</option>
                    </select>
                </div>

                <!-- Bouton Commencer -->
                <button class="btn" id="startBtn">Commencer</button>
            </div>
        </div>

        <script>
            const langSelect = document.getElementById('lang');
            const langLabel = document.getElementById('langLabel');
            const startBtn = document.getElementById('startBtn');
            const welcomeTitle = document.getElementById('welcomeTitle');

            const savedLang = localStorage.getItem('lang');
            if(savedLang) {
                langSelect.value = savedLang;
                updateText(savedLang);
            }

            langSelect.addEventListener('change', () => {
                const selected = langSelect.value;
                localStorage.setItem('lang', selected);
                updateText(selected);
            });

            function updateText(lang) {
                if(lang === 'en') {
                    langLabel.textContent = "Choose your language and start with us to explore the ASSHA environment — a world of solidarity and support:";
                    startBtn.textContent = "Start";
                    welcomeTitle.textContent = "Welcome to ASSHA";
                } else {
                    langLabel.textContent = "Choisissez votre langue et commencez avec nous la découverte de l’univers ASSHA — un monde d’entraide et de solidarité :";
                    startBtn.textContent = "Commencer";
                    welcomeTitle.textContent = "Bienvenue chez ASSHA";
                }
            }

            startBtn.addEventListener('click', () => {
                window.location.href = '/profil';
            });
        </script>
    </body>
    </html>
    `;

    res.send(html);
});



// -------------------- Route : Page Profil --------------------
// -------------------- Route : Page principale Profil --------------------
app.get("/profil", (req, res) => {
    const optionsFR = [
        "Me connecter",
        "Découvrir qui sommes-nous",
        "Notre politique d'adhésion",
        "M'inscrire et devenir membre",
        "Faire une visite de bienfaisance",
        "Politique de confidentialité"
    ];

    const optionsEN = [
        "Log in",
        "Who we are",
        "Membership policy",
        "Sign up and become a member",
        "Visit as a guest to make a donation",
        "Privacy policy"
    ];

    const urls = [
        "/login",
        "/profil/qui-sommes-nous",
        "/profil/politique-adhesion",
        "/profil/inscription",
        "/profil/visite-bienfaisance",
        "/profil/politique-confidentialite"
    ];

    res.send(`
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Profil — ASSHA</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
*{box-sizing:border-box; margin:0; padding:0;}

body{
    font-family:Arial,sans-serif;
    background:#eef2f9;
    padding-top:70px; /* espace pour header fixe */
    display:flex;
    justify-content:center;
}

header {
    position:fixed;
    top:0; left:0;
    width:100%;
    background:#0b57d0;
    color:white;
    display:flex;
    align-items:center;
    padding:10px 20px;
    z-index:1000;
}

header img { height:40px; border-radius:50%; margin-right:10px; }
header h1 { font-size:20px; font-weight:bold; margin:0; }

.card{
    max-width:520px;
    width:100%;
    background:white;
    padding:30px;
    border-radius:18px;
    box-shadow:0 10px 25px rgba(0,0,0,0.12);
    position:relative;
}

h2{
    text-align:center;
    font-size:26px;
    color:#0b57d0;
    margin-bottom:20px;
}

.option{
    background:#f4f6fa;
    padding:15px 20px;
    margin:10px 0;
    border-radius:12px;
    cursor:pointer;
    transition:all .25s ease;
    font-size:17px;
    text-align:center;
    color:#333;
    font-weight:500;
}

.option:hover{
    background:#0b57d0;
    color:#fff;
    transform:translateY(-2px);
}

/* bouton retour centré en bas */
.floating-back-btn {
    position:fixed;
    bottom:20px;
    left:50%;
    transform:translateX(-50%);
    background:#28a745; /* vert succès */
    color:white;
    padding:12px 20px;
    border-radius:30px;
    font-size:18px;
    text-align:center;
    text-decoration:none;
    box-shadow:0 5px 15px rgba(0,0,0,0.3);
    z-index:1001;
    display:flex;
    align-items:center;
    gap:8px;
    transition: transform 0.2s, background 0.2s;
}

.floating-back-btn:hover{
    transform:translateX(-50%) scale(1.05);
    background:#218838;
}

@media(max-width:600px){
    .card{padding:25px 20px}
    h2{font-size:22px}
    .option{font-size:16px}
    .floating-back-btn{font-size:16px; padding:10px 16px;}
}
</style>
</head>

<body>

<header>
    <img src="/img/log2.jpg" alt="ASSHA">
    <h1>ASSHA</h1>
</header>

<div class="card">

    <h2 id="introText">Par où voudriez-vous que l’on commence ?</h2>

    <div id="optionsContainer"></div>

</div>

<!-- bouton flottant -->
<a href="/" class="floating-back-btn" id="backBtn">
    &#8592; <span>Retour</span>
</a>

<script>
const optionsFR = ${JSON.stringify(optionsFR)};
const optionsEN = ${JSON.stringify(optionsEN)};
const urls = ${JSON.stringify(urls)};

const introFR = "Par où voudriez-vous que l’on commence ?";
const introEN = "Where would you like to start?";

const optionsContainer = document.getElementById("optionsContainer");
const introText = document.getElementById("introText");
const backBtn = document.getElementById("backBtn");

const lang = localStorage.getItem("lang") || "fr";

function setLanguage(lang){
    introText.textContent = lang === "en" ? introEN : introFR;
    backBtn.querySelector("span").textContent = lang === "en" ? "Back" : "Retour";

    const options = lang === "en" ? optionsEN : optionsFR;
    optionsContainer.innerHTML = "";

    options.forEach((text, index) => {
        const div = document.createElement("div");
        div.className = "option";
        div.textContent = text;
        div.onclick = () => window.location.href = urls[index];
        optionsContainer.appendChild(div);
    });
}

setLanguage(lang);
</script>

</body>
</html>
    `);
});



app.get("/profil/qui-sommes-nous", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Qui sommes-nous — ASSHA</title>
<meta name="viewport" content="width=device-width, initial-scale=1">

<style>
*{box-sizing:border-box;margin:0;padding:0}

body{
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  background:#eef2f9;
  color:#222;
  overflow-x:hidden;
}

/* HEADER FIXE */
.header-bar{
  position:fixed;
  top:0;left:0;
  width:100%;
  height:clamp(52px,8vw,64px);
  background:#0b57d0;
  color:#fff;
  display:flex;
  align-items:center;
  justify-content:center;
  font-weight:600;
  font-size:clamp(.95rem,3.5vw,1.15rem);
  z-index:1000;
  box-shadow:0 2px 6px rgba(0,0,0,.15);
}

/* CONTENEUR */
.wrapper{
  padding-top:clamp(70px,12vw,90px);
  padding-bottom:clamp(90px,14vw,120px);
  display:flex;
  justify-content:center;
  padding-left:1rem;
  padding-right:1rem;
}

/* CARTE */
.card{
  width:100%;
  max-width:620px;
  background:#fff;
  border-radius:18px;
  box-shadow:0 8px 22px rgba(0,0,0,.12);
  padding:clamp(1rem,4vw,1.6rem);
}

/* TITRE */
.title{
  text-align:center;
  font-weight:700;
  font-size:clamp(1.35rem,5vw,1.9rem);
  margin-bottom:1.2rem;
}

/* IMAGE */
.card img{
  width:100%;
  max-height:clamp(160px,40vw,240px);
  object-fit:cover;
  border-radius:14px;
  margin-bottom:1.4rem;
}

/* CONTENU */
.content{
  line-height:1.75;
  font-size:clamp(.9rem,3.5vw,1.05rem);
}

.content h5{
  font-size:clamp(1rem,4vw,1.2rem);
  font-weight:700;
  margin:1.3rem 0 .6rem;
  color:#000;
}

/* BOUTON RETOUR FIXE */
.back-btn{
  position:fixed;
  bottom:clamp(10px,4vw,18px);
  left:50%;
  transform:translateX(-50%);
  width:min(90%,320px);
  padding:clamp(.65rem,3.5vw,.9rem);
  background:#ff9800;
  color:#fff;
  font-weight:600;
  font-size:clamp(.9rem,4vw,1.05rem);
  text-decoration:none;
  border-radius:18px;
  display:flex;
  align-items:center;
  justify-content:center;
  gap:.5rem;
  box-shadow:0 4px 10px rgba(0,0,0,.25);
  transition:.25s ease;
  z-index:1000;
}

.back-btn:hover{
  background:#e68900;
  transform:translateX(-50%) translateY(-3px);
  box-shadow:0 6px 14px rgba(0,0,0,.3);
}

@media(min-width:1024px){
  .back-btn{max-width:280px;font-size:.95rem}
}
</style>
</head>

<body>

<div class="header-bar" id="headerTitle">Qui sommes-nous</div>

<div class="wrapper">
  <div class="card">
    <div class="title" id="pageTitle">Découvrir qui sommes-nous</div>

    <img src="/img/atencion2.jpeg" alt="ASSHA">

    <div class="content" id="pageContent"></div>
  </div>
</div>

<a href="/profil" class="back-btn">
  <span>←</span><span id="backText">Retour</span>
</a>

<script>
const lang = localStorage.getItem("lang") || "fr";

const texts = {
  fr:{
    title:"Découvrir qui sommes-nous",
    back:"Retour",
    content:\`
<h5>QUI SOMMES NOUS ?</h5>
L’Association des Hommes d'Affaires Chrétiens, Croyants du Message du Temps de la Fin, « ASSHA-CMTF » en sigle, est une Association sans but lucratif à caractère non-confessionnelle et philanthropique, destinée à la grande famille Chrétienne en général, et à la famille restreinte des croyants du message du temps de la fin prêché par le Prophète William Marrion Branham.
Lancée le 05 avril 2025, les actions de l’Association remontent à 2021, avec plusieurs bénéficiaires, missionnaires, veuves et orphelins.
<br><br>

<h5>NOTRE VISION</h5>
Par l’action des Hommes Affaires, nous cherchons à susciter ou renforcer la communion fraternelle et l’amour divin parmi les croyants du message du temps de la fin et les serviteurs de Dieu, malgré leurs différences doctrinales.
<br><br>

<h5>NOTRE MISSION</h5>
- La communion fraternelle entre croyants et églises ;<br>
- Appui aux missionnaires et aux églises opérant dans des contrées pauvres et difficiles ; <br>
- Assister les veuves et les orphelins des serviteurs de Dieu qui nous ont précédés ; <br>
- Partage d’expériences et renforcement des capacités des hommes d’affaires, en particulier les jeunes et les femmes.
\`
  },

  en:{
    title:"Who we are",
    back:"Back",
    content:\`
<h5>WHO WE ARE?</h5>
The Association of Christian Businessmen, Believers of the End-Time Message, "ASSHA-CMTF" for short, is a non-profit, non-denominational, philanthropic association, intended for the larger Christian family in general, and the restricted family of believers of the End-Time Message preached by Prophet William Marrion Branham.
Launched on April 5, 2025, the Association's actions date back to 2021, benefiting many recipients, missionaries, widows, and orphans.
<br><br>

<h5>OUR VISION</h5>
Through the action of Businessmen, we aim to foster or strengthen fraternal communion and divine love among believers of the End-Time Message and servants of God, despite doctrinal differences.
<br><br>

<h5>OUR MISSION</h5>
- Fraternal communion among believers and churches;<br>
- Support to missionaries and churches in poor and difficult areas;<br>
- Assist widows and orphans of God’s servants who preceded us;<br>
- Sharing experiences and capacity building for businessmen, especially young people and women.
\`
  }
};

document.getElementById("headerTitle").textContent = texts[lang].title;
document.getElementById("pageTitle").textContent = texts[lang].title;
document.getElementById("backText").textContent = texts[lang].back;
document.getElementById("pageContent").innerHTML = texts[lang].content;
</script>

</body>
</html>`);
});





app.get("/profil/politique-adhesion", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Politique d'adhésion — ASSHA</title>
<meta name="viewport" content="width=device-width, initial-scale=1">

<style>
*{box-sizing:border-box;margin:0;padding:0}

body{
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  background:#eef2f9;
  color:#222;
  overflow-x:hidden;
}

.header-bar{
  position:fixed;
  top:0;left:0;
  width:100%;
  height:clamp(52px,8vw,64px);
  background:#0b57d0;
  color:#fff;
  display:flex;
  align-items:center;
  justify-content:center;
  font-weight:600;
  font-size:clamp(0.95rem,3.5vw,1.15rem);
  z-index:1000;
  box-shadow:0 2px 6px rgba(0,0,0,.15);
}

.wrapper{
  padding-top:clamp(70px,12vw,90px);
  padding-bottom:clamp(90px,14vw,120px);
  display:flex;
  justify-content:center;
  padding-left:1rem;
  padding-right:1rem;
}

.card{
  width:100%;
  max-width:620px;
  background:#fff;
  border-radius:18px;
  box-shadow:0 8px 22px rgba(0,0,0,.12);
  padding:clamp(1rem,4vw,1.6rem);
}

.title{
  text-align:center;
  font-weight:700;
  font-size:clamp(1.35rem,5vw,1.9rem);
  margin-bottom:1.2rem;
}

.card img{
  width:100%;
  max-height:clamp(160px,40vw,240px);
  object-fit:cover;
  border-radius:14px;
  margin-bottom:1.4rem;
}

.content{
  line-height:1.75;
  font-size:clamp(.9rem,3.5vw,1.05rem);
}

.content h5{
  font-size:clamp(1rem,4vw,1.2rem);
  font-weight:700;
  margin:1.3rem 0 .6rem;
  color:#000;
}

.back-btn{
  position:fixed;
  bottom:clamp(10px,4vw,18px);
  left:50%;
  transform:translateX(-50%);
  width:min(90%,320px);
  padding:clamp(.65rem,3.5vw,.9rem);
  background:#28a745;
  color:#fff;
  font-weight:600;
  font-size:clamp(.9rem,4vw,1.05rem);
  text-decoration:none;
  border-radius:18px;
  display:flex;
  align-items:center;
  justify-content:center;
  gap:.5rem;
  box-shadow:0 4px 10px rgba(0,0,0,.25);
  transition:.25s ease;
  z-index:1000;
}

.back-btn:hover{
  background:#218838;
  transform:translateX(-50%) translateY(-3px);
  box-shadow:0 6px 14px rgba(0,0,0,.3);
}

@media(min-width:1024px){
  .back-btn{max-width:280px;font-size:.95rem}
}
</style>
</head>

<body>

<div class="header-bar" id="headerTitle">Politique d'adhésion</div>

<div class="wrapper">
  <div class="card">
    <div class="title" id="pageTitle">Notre politique d'adhésion</div>

    <img src="/img/ikusi.jpeg" alt="ASSHA">

    <div class="content" id="pageContent"></div>
  </div>
</div>

<a href="/profil" class="back-btn">
  <span>←</span><span id="backText">Retour</span>
</a>

<script>
const lang = localStorage.getItem("lang") || "fr";

const texts = {
  fr:{
    title:"Notre politique d'adhésion",
    back:"Retour",
    content:\`
L’adhésion à l’ASSHA-CMTF est volontaire. Ses membres respectent les Statuts et règlements
de l’Association et observent les valeurs chrétiennes concernant l’amour et la communion fraternels.<br><br>

<h5>NOS MOYENS D’ACTION</h5>
- Contributions et cotisations mensuelles des membres ;<br>
- Campagnes spéciales de collecte de fonds ;<br>
- Dons, legs et subventions des partenaires ;<br>
- Activités récurrentes : déjeuners et diners, Convention/Concert annuel de l’Unité, etc. ;<br>
- Évènements ponctuels.<br><br>

<h5>NOS CATEGORIES DE MEMBRES</h5>
- Membres d’honneur <br>
- Membres Effectifs <br>
- Membres Sympathisants<br><br>

<h5>NOS VALEURS</h5>
- Charité et Chrétienté ;<br>
- Fraternité et Intégrité ; <br>
- Transparence et Efficacité ;<br>
- La libéralité.
\`
  },

  en:{
    title:"Membership policy",
    back:"Back",
    content:\`
Membership to ASSHA-CMTF is voluntary. Members comply with the Statutes and Regulations
of the Association and observe Christian values regarding love and fraternal communion.<br><br>

<h5>OUR ACTION MEANS</h5>
- Monthly contributions and fees from members;<br>
- Special fundraising campaigns;<br>
- Donations, legacies, and grants from partners;<br>
- Recurring activities: lunches and dinners, Annual Unity Convention/Concert, etc.;<br>
- Occasional events.<br><br>

<h5>CATEGORIES OF MEMBERS</h5>
- Honorary members <br>
- Active members <br>
- Supporting members<br><br>

<h5>OUR VALUES</h5>
- Charity and Christianity ;<br>
- Fraternity and Integrity ; <br>
- Transparency and Efficiency ;<br>
- Generosity.
\`
  }
};

document.getElementById("headerTitle").textContent = texts[lang].title;
document.getElementById("pageTitle").textContent = texts[lang].title;
document.getElementById("backText").textContent = texts[lang].back;
document.getElementById("pageContent").innerHTML = texts[lang].content;
</script>

</body>
</html>`);
});




app.get("/profil/inscription", (req, res) => {
    res.send(`
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Inscription — ASSHA</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
        <style>
            * { box-sizing: border-box; }

            body { margin:0; padding-top:70px; font-family: Arial, sans-serif; background: #eef2f9; }

            /* Header fixe */
            .header-fixed {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 60px;
                background: #0b57d0;
                display: flex;
                align-items: center;
                padding: 0 20px;
                color: white;
                font-size: 22px;
                font-weight: bold;
                z-index: 1000;
                box-shadow: 0 2px 6px rgba(0,0,0,0.2);
            }
            .header-fixed img {
                height: 40px;
                margin-right: 15px;
                border-radius: 50%;
            }

            /* Carte formulaire */
            .card { 
                width:100%; 
                max-width:650px; 
                margin:20px auto 60px auto; 
                background:white; 
                padding:25px; 
                border-radius:18px; 
                box-shadow:0 10px 25px rgba(0,0,0,0.12); 
                position: relative;
            }

            /* Image en haut du formulaire */
            .form-logo { 
                display: block; 
                max-width: 220px; 
                width: 100%; 
                height: auto; 
                margin: 0 auto 20px; 
                border-radius: 12px; 
            }
            @media(max-width:768px){ .form-logo { max-width:180px; } }
            @media(max-width:480px){ .form-logo { max-width:140px; } }

            .card-title { font-size:16px; line-height:1.7; color:#555; margin-bottom:20px; }
            .card-title h5 { font-weight:bold; color:black; margin-bottom:10px; }

            form .form-group { margin-bottom:15px; }
            input, select { width:100%; padding:10px 12px; border-radius:8px; border:1px solid #ccc; font-size:15px; }
            button { background:#0b57d0; color:white; border:none; padding:12px 20px; border-radius:10px; font-size:16px; cursor:pointer; }
            button:hover { background:#0845a0; }

            /* Bouton Suivant */
            #nextBtn { float:right; margin-top:10px; }

            /* Bouton Retour fixe et cohérent */
            #backBtn { 
                position: fixed; 
                left: 20px; 
                bottom: 20px; 
                background: #555; 
                color: white; 
                padding: 10px 16px; 
                border-radius: 12px; 
                font-size: 16px; 
                text-decoration:none; 
                display:flex; 
                align-items:center; 
                gap:6px; 
                box-shadow: 0 5px 15px rgba(0,0,0,0.2);
                transition: all 0.2s ease;
            }
            #backBtn:hover { 
                background:#333; 
                transform: scale(1.05); 
            }

            @media(max-width:480px){
                h1{font-size:22px;} 
                #nextBtn{ font-size:14px; padding:10px 15px; } 
                #backBtn{ font-size:14px; padding:8px 12px; left:10px; bottom:10px; }
            }
        </style>
    </head>
    <body>
        <!-- Header fixe -->
        <div class="header-fixed">
            <img src="/img/log2.jpg" alt="ASSHA">
            ASSHA
        </div>

        <!-- Carte formulaire -->
        <div class="card">
            <!-- Image au-dessus du formulaire -->
            <img src="/img/ins.jpg" class="form-logo" alt="ASSHA">

            <div class="card-title">
                <h5 id="formTitle">Complétez le formulaire pour devenir membre</h5>
            </div>

            <form id="registrationForm">
                <div class="form-group">
                    <label id="labelNom">Nom</label>
                    <input type="text" placeholder="Nom" id="inputNom"/>
                </div>
                <div class="form-group">
                    <label id="labelPostNom">Post-nom</label>
                    <input type="text" placeholder="Post-nom" id="inputPostNom"/>
                </div>
                <div class="form-group">
                    <label id="labelPrenom">Prénom</label>
                    <input type="text" placeholder="Prénom" id="inputPrenom"/>
                </div>
                <div class="form-group">
                    <label id="labelEmail">Email</label>
                    <input type="email" placeholder="Email" id="inputEmail"/>
                </div>
                <div class="form-group">
                    <label id="labelPays">Pays</label>
                    <select id="selectPays"></select>
                </div>
                <div class="form-group">
                    <label id="labelPwd">Créer Mot de passe</label>
                    <input type="password" placeholder="Mot de passe" id="inputPwd"/>
                </div>
                <div class="form-group">
                    <label id="labelConfPwd">Confirmer Mot de passe</label>
                    <input type="password" placeholder="Mot de passe" id="inputConfPwd"/>
                </div>
                <button type="button" id="nextBtn">Suivant</button>
            </form>
        </div>

        <!-- Bouton retour figé -->
        <a href="/profil" id="backBtn">&#8592; Retour</a>

        <script>
            const lang = localStorage.getItem('lang') || 'fr';

            const texts = {
                fr: {
                    formTitle: "Veuillez remplir votre formulaire de session",
                    labelNom: "Nom",
                    labelPostNom: "Post-nom",
                    labelPrenom: "Prénom",
                    labelEmail: "Email",
                    labelPays: "Pays",
                    labelPwd: "Créer Mot de passe",
                    labelConfPwd: "Confirmer Mot de passe",
                    inputNom: "Nom",
                    inputPostNom: "Post-nom",
                    inputPrenom: "Prénom",
                    inputEmail: "Email",
                    inputPwd: "Mot de passe",
                    inputConfPwd: "Mot de passe",
                    nextBtn: "Suivant",
                    nextPage: "/profil/inscription-suite"
                },
                en: {
                    formTitle: "Please fill out your session form",
                    labelNom: "Last Name",
                    labelPostNom: "Middle Name",
                    labelPrenom: "First Name",
                    labelEmail: "Email",
                    labelPays: "Country",
                    labelPwd: "Create Password",
                    labelConfPwd: "Confirm Password",
                    inputNom: "Last Name",
                    inputPostNom: "Middle Name",
                    inputPrenom: "First Name",
                    inputEmail: "Email",
                    inputPwd: "Password",
                    inputConfPwd: "Password",
                    nextBtn: "Next",
                    nextPage: "/profil/inscription-suite"
                }
            };

            const countries = {
                fr: ["République démocratique du Congo","France","Belgique","Canada","Suisse","Allemagne","Maroc","Tunisie","Cameroun","Côte d'Ivoire"],
                en: ["Democratic Republic of Congo","France","Belgium","Canada","Switzerland","Germany","Morocco","Tunisia","Cameroon","Ivory Coast"]
            };

            const t = texts[lang];
            document.getElementById('formTitle').textContent = t.formTitle;
            document.getElementById('labelNom').textContent = t.labelNom;
            document.getElementById('labelPostNom').textContent = t.labelPostNom;
            document.getElementById('labelPrenom').textContent = t.labelPrenom;
            document.getElementById('labelEmail').textContent = t.labelEmail;
            document.getElementById('labelPays').textContent = t.labelPays;
            document.getElementById('labelPwd').textContent = t.labelPwd;
            document.getElementById('labelConfPwd').textContent = t.labelConfPwd;
            document.getElementById('inputNom').placeholder = t.inputNom;
            document.getElementById('inputPostNom').placeholder = t.inputPostNom;
            document.getElementById('inputPrenom').placeholder = t.inputPrenom;
            document.getElementById('inputEmail').placeholder = t.inputEmail;
            document.getElementById('inputPwd').placeholder = t.inputPwd;
            document.getElementById('inputConfPwd').placeholder = t.inputConfPwd;
            document.getElementById('nextBtn').textContent = t.nextBtn;

            const select = document.getElementById('selectPays');
            select.innerHTML = "";
            countries[lang].forEach(country => {
                const opt = document.createElement('option');
                opt.value = country;
                opt.textContent = country;
                select.appendChild(opt);
            });

            document.getElementById('nextBtn').addEventListener('click', () => {
                window.location.href = t.nextPage;
            });
        </script>
    </body>
    </html>
    `);
});


app.get("/profil/inscription-suite", (req, res) => {
    res.send(`
<html>
<head>
<meta charset="UTF-8">
<title>Inscription — ASSHA</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
<style>
* { box-sizing: border-box; margin:0; padding:0; }
body { font-family: Arial, sans-serif; background:#eef2f9; padding-top:70px; display:flex; flex-direction:column; align-items:center; }

header { position:fixed; top:0; left:0; width:100%; background:#0b57d0; color:white; display:flex; align-items:center; padding:10px 20px; z-index:1000; }
header img { height:40px; border-radius:50%; margin-right:10px; }
header h1 { font-size:20px; font-weight:bold; margin:0; }

.card { max-width:600px; width:100%; background:white; padding:25px; border-radius:18px; box-shadow:0 10px 25px rgba(0,0,0,0.12); }
.card img { width:100%; max-height:250px; object-fit:cover; border-radius:12px; margin-bottom:20px; }

h1 { text-align:center; color:#0b57d0; font-size:26px; margin-bottom:20px; }
p { font-size:16px; line-height:1.6; color:#555; text-align:center; }
a.btn { display:block; text-align:center; margin-top:20px; text-decoration:none; background:#0b57d0; color:white; padding:14px 20px; border-radius:10px; font-size:18px; font-weight:bold; transition:all 0.3s; }
a.btn:hover { background:#0845a0; }

@media(max-width:768px){ h1{font-size:22px;} p{font-size:15px;} a.btn{font-size:16px; padding:12px 18px;} .card img{max-height:200px;} }
@media(max-width:480px){ h1{font-size:20px;} p{font-size:14px;} a.btn{font-size:14px; padding:10px 16px;} .card img{max-height:150px;} }
</style>
</head>
<body>

<header>
<img src="/img/log2.jpg" alt="ASSHA">
<h1 style="color: white;" >ASSHA</h1>
</header>

<div class="card">
<img src="/img/bon.avif" alt="Bannière" />
<h1 id="pageTitle">Vous y êtes presque !</h1>
<p id="pageContent">
Pour accéder maintenant au forum, il vous faut compléter les formulaires d’adhésion.
</p>
<a href="/profil/adhesion" class="btn" id="continueBtn">Compléter l’adhésion</a>
</div>

<script>
const lang = localStorage.getItem('lang') || 'fr';
const titles = { fr:"Vous y êtes presque !", en:"Almost there!" };
const contents = { 
    fr:"Pour accéder maintenant au forum, il vous faut compléter les formulaires d’adhésion.",
    en:"To access the forum, you need to complete the membership forms."
};
const btnTexts = { fr:"Compléter l’adhésion", en:"Complete Membership" };
document.getElementById('pageTitle').textContent = titles[lang];
document.getElementById('pageContent').textContent = contents[lang];
document.getElementById('continueBtn').textContent = btnTexts[lang];
</script>

</body>
</html>
    `);
});















app.get("/profil/adhesion", (req, res) => {
    res.send(`
<html>
<head>
<meta charset="UTF-8">
<title>Adhésion — ASSHA</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
* { box-sizing: border-box; }
body { margin:0; padding:0; font-family: Arial, sans-serif; background:#eef2f9; }
header {
    position: fixed;
    top:0; left:0; right:0;
    height:60px; 
    background:#0b57d0; 
    display:flex; 
    align-items:center; 
    padding:0 20px;
    z-index:1000;
}
header img { height:40px; border-radius:8px; margin-right:10px; }
header h1 { color:white; font-size:22px; margin:0; flex:1; }

.card { 
    width:100%; 
    max-width:650px; 
    background:white; 
    border-radius:18px; 
    padding:100px 25px 40px; 
    box-shadow:0 10px 25px rgba(0,0,0,0.12); 
    margin:0 auto;
    box-sizing:border-box;
    position:relative;
}

h1.card-title { text-align:center; color:#0b57d0; font-size:26px; margin-bottom:20px; }

.form-group { margin-bottom:15px; display:flex; flex-direction:column; }
label { margin-bottom:5px; font-weight:bold; color:#555; }
input, select {
    width:100%;
    padding:10px 12px;
    border-radius:8px;
    border:1px solid #ccc;
    font-size:15px;
    box-sizing:border-box;
}

.buttons { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:10px; margin-top:25px; }
a.btn { display:inline-block; text-decoration:none; text-align:center; color:white; background:#0b57d0; padding:12px 20px; border-radius:10px; font-size:18px; font-weight:bold; min-width:120px; }
a.prev { background:#555; }

#backFloating {
    position: fixed;
    bottom:20px;
    left:20px;
    display:flex;
    align-items:center;
    background:#555;
    color:white;
    padding:10px 14px;
    border-radius:12px;
    font-size:16px;
    text-decoration:none;
    z-index:1000;
    box-shadow:0 5px 15px rgba(0,0,0,0.2);
    transition: all 0.2s ease;
}
#backFloating:hover { background:#333; transform: scale(1.05); }

@media(max-width:480px){
    header h1{ font-size:18px; }
    .card{ padding:80px 15px 40px; }
    h1.card-title{ font-size:22px; }
    input, select{ font-size:14px; padding:8px 10px; }
    a.btn{ font-size:16px; padding:10px 0; min-width:100px; }
    #backFloating{ font-size:14px; padding:8px 10px; }
}
</style>
</head>
<body>
<header>
    <img src="/img/log2.jpg" alt="ASSHA">
    <h1>ASSHA</h1>
</header>

<div class="card">
<h1 class="card-title" id="pageTitle">Étape 1 — Informations personnelles</h1>
<form>
    <div class="form-group">
        <label for="surname" id="labelSurname">Nom de famille</label>
        <input type="text" id="surname" placeholder="Entrez votre nom de famille" />
    </div>
    <div class="form-group">
        <label for="name" id="labelName">Prénom</label>
        <input type="text" id="name" placeholder="Entrez votre prénom" />
    </div>
    <div class="form-group">
        <label for="birthplace" id="labelBirthplace">Lieu de naissance</label>
        <input type="text" id="birthplace" placeholder="Entrez votre lieu de naissance" />
    </div>
    <div class="form-group">
        <label for="birthdate" id="labelBirthdate">Date de naissance</label>
        <input type="date" id="birthdate" />
    </div>
    <div class="form-group">
        <label for="nationality" id="labelNationality">Nationalité</label>
        <input type="text" id="nationality" placeholder="Entrez votre nationalité" />
    </div>
    <div class="form-group">
        <label for="marital" id="labelMarital">Situation matrimoniale</label>
        <select id="marital"></select>
    </div>
    <div class="form-group">
        <label for="residency" id="labelResidency">Adresse de résidence</label>
        <input type="text" id="residency" placeholder="Entrez votre adresse" />
    </div>
    <div class="buttons">
        <a href="/profil/adhesion-2" class="btn next" id="nextBtn">Suivant</a>
    </div>
</form>
</div>

<a href="/profil" id="backFloating">&#8592; Retour</a>

<script>
const lang = localStorage.getItem('lang') || 'fr';
const texts = {
    fr: {
        pageTitle: "Étape 1 — Informations personnelles",
        labelSurname:"Nom de famille", placeholderSurname:"Entrez votre nom de famille",
        labelName:"Prénom", placeholderName:"Entrez votre prénom",
        labelBirthplace:"Lieu de naissance", placeholderBirthplace:"Entrez votre lieu de naissance",
        labelBirthdate:"Date de naissance",
        labelNationality:"Nationalité", placeholderNationality:"Entrez votre nationalité",
        labelMarital:"Situation matrimoniale",
        maritalOptions:["Célibataire","Marié(e)"],
        labelResidency:"Adresse de résidence", placeholderResidency:"Entrez votre adresse",
        nextBtn:"Suivant"
    },
    en: {
        pageTitle: "Step 1 — Personal Information",
        labelSurname:"Surname", placeholderSurname:"Enter your surname",
        labelName:"Name", placeholderName:"Enter your name",
        labelBirthplace:"Birthplace", placeholderBirthplace:"Enter your birthplace",
        labelBirthdate:"Birthdate",
        labelNationality:"Nationality", placeholderNationality:"Enter your nationality",
        labelMarital:"Marital Status",
        maritalOptions:["Single","Married"],
        labelResidency:"Residential Address", placeholderResidency:"Enter your address",
        nextBtn:"Next"
    }
};

// Labels et placeholders
document.getElementById('pageTitle').textContent = texts[lang].pageTitle;
document.getElementById('labelSurname').textContent = texts[lang].labelSurname;
document.getElementById('surname').placeholder = texts[lang].placeholderSurname;
document.getElementById('labelName').textContent = texts[lang].labelName;
document.getElementById('name').placeholder = texts[lang].placeholderName;
document.getElementById('labelBirthplace').textContent = texts[lang].labelBirthplace;
document.getElementById('birthplace').placeholder = texts[lang].placeholderBirthplace;
document.getElementById('labelBirthdate').textContent = texts[lang].labelBirthdate;
document.getElementById('labelNationality').textContent = texts[lang].labelNationality;
document.getElementById('nationality').placeholder = texts[lang].placeholderNationality;
document.getElementById('labelMarital').textContent = texts[lang].labelMarital;
document.getElementById('labelResidency').textContent = texts[lang].labelResidency;
document.getElementById('residency').placeholder = texts[lang].placeholderResidency;
document.getElementById('nextBtn').textContent = texts[lang].nextBtn;

// Remplir select
const maritalSelect = document.getElementById('marital');
texts[lang].maritalOptions.forEach(opt=>{
    const option = document.createElement('option');
    option.textContent = opt;
    maritalSelect.appendChild(option);
});
</script>
</body>
</html>
    `);
});



app.get("/profil/adhesion-2", (req, res) => {
    res.send(`
<html>
<head>
<meta charset="UTF-8">
<title>Adhésion — ASSHA</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
* { box-sizing: border-box; }
body { margin:0; padding:0; font-family: Arial, sans-serif; background:#eef2f9; }

header {
    position: fixed;
    top:0; left:0; right:0;
    height:60px; 
    background:#0b57d0; 
    display:flex; 
    align-items:center; 
    padding:0 20px;
    z-index:1000;
}
header img { height:40px; border-radius:8px; margin-right:10px; }
header h1 { color:white; font-size:22px; margin:0; flex:1; }

.card { 
    width:100%; 
    max-width:650px; 
    background:white; 
    border-radius:18px; 
    padding:100px 25px 40px; 
    box-shadow:0 10px 25px rgba(0,0,0,0.12); 
    margin:0 auto;
    box-sizing:border-box;
    position:relative;
}

h1.card-title { text-align:center; color:#0b57d0; font-size:26px; margin-bottom:20px; }

.form-group { margin-bottom:15px; display:flex; flex-direction:column; }
label { margin-bottom:5px; font-weight:bold; color:#555; }
input, select {
    width:100%;
    padding:10px 12px;
    border-radius:8px;
    border:1px solid #ccc;
    font-size:15px;
    box-sizing:border-box;
}

.buttons { display:flex; justify-content:flex-end; margin-top:25px; }
a.btn { display:inline-block; text-decoration:none; text-align:center; color:white; background:#0b57d0; padding:8px 12px; border-radius:8px; font-size:16px; font-weight:bold; min-width:100px; box-sizing:border-box; }

#backFloating {
    position: fixed;
    bottom:20px;
    left:20px;
    display:flex;
    align-items:center;
    background:#555;
    color:white;
    padding:10px 14px;
    border-radius:12px;
    font-size:16px;
    text-decoration:none;
    z-index:1000;
    box-shadow:0 5px 15px rgba(0,0,0,0.2);
    transition: all 0.2s ease;
}
#backFloating:hover { background:#333; transform: scale(1.05); }

@media(max-width:480px){
    header h1{ font-size:18px; }
    .card{ padding:80px 15px 40px; }
    h1.card-title{ font-size:22px; }
    input, select{ font-size:14px; padding:8px 10px; }
    a.btn{ font-size:14px; padding:6px 10px; min-width:80px; }
    #backFloating{ font-size:14px; padding:8px 10px; }
}
</style>
</head>
<body>

<header>
    <img src="/img/log2.jpg" alt="ASSHA">
    <h1>ASSHA</h1>
</header>

<div class="card">
<h1 class="card-title" id="pageTitle">Étape 2 — Informations supplémentaires</h1>
<form>
    <div class="form-group">
        <label for="phone" id="labelPhone">Téléphone</label>
        <input type="number" id="phone" placeholder="ex: 089..." />
    </div>
    <div class="form-group">
        <label for="email" id="labelEmail">Email</label>
        <input type="email" id="email" placeholder="ex: jack@yyy..." />
    </div>
    <div class="form-group">
        <label for="profession" id="labelProfession">Profession</label>
        <input type="text" id="profession" placeholder="Activité" />
    </div>
    <div class="form-group">
        <label for="secteur" id="labelSecteur">Secteur d'activité</label>
        <input type="text" id="secteur" placeholder="Secteur" />
    </div>
    <div class="form-group">
        <label for="eglise" id="labelEglise">Votre église</label>
        <input type="text" id="eglise" placeholder="Nom de l'église" />
    </div>
    <div class="form-group">
        <label for="pasteur" id="labelPasteur">Votre Pasteur</label>
        <input type="text" id="pasteur" placeholder="Nom du pasteur" />
    </div>
    <div class="form-group">
        <label for="message" id="labelMessage">Église croit au Message ?</label>
        <select id="message"></select>
    </div>
    <div class="buttons">
        <a href="/profil/adhesion-3" class="btn next" id="nextBtn">Suivant</a>
    </div>
</form>
</div>

<a href="/profil/adhesion" id="backFloating">&#8592; Retour</a>

<script>
const lang = localStorage.getItem('lang') || 'fr';
const texts = {
    fr: {
        pageTitle: "Étape 2 — Informations supplémentaires",
        labelPhone:"Téléphone", placeholderPhone:"ex: 089...",
        labelEmail:"Email", placeholderEmail:"ex: jack@yyy...",
        labelProfession:"Profession", placeholderProfession:"Activité",
        labelSecteur:"Secteur d'activité", placeholderSecteur:"Secteur",
        labelEglise:"Votre église", placeholderEglise:"Nom de l'église",
        labelPasteur:"Votre Pasteur", placeholderPasteur:"Nom du pasteur",
        labelMessage:"Église croit au Message ?",
        messageOptions:["Oui","Non"],
        nextBtn:"Suivant"
    },
    en: {
        pageTitle: "Step 2 — Additional Information",
        labelPhone:"Phone", placeholderPhone:"ex: 089...",
        labelEmail:"Email", placeholderEmail:"ex: jack@yyy...",
        labelProfession:"Profession", placeholderProfession:"Activity",
        labelSecteur:"Sector", placeholderSecteur:"Sector",
        labelEglise:"Your church", placeholderEglise:"Church name",
        labelPasteur:"Your Pastor", placeholderPasteur:"Pastor name",
        labelMessage:"Does your church believe in the Message?",
        messageOptions:["Yes","No"],
        nextBtn:"Next"
    }
};

// Labels et boutons
document.getElementById('pageTitle').textContent = texts[lang].pageTitle;
document.getElementById('labelPhone').textContent = texts[lang].labelPhone;
document.getElementById('phone').placeholder = texts[lang].placeholderPhone;
document.getElementById('labelEmail').textContent = texts[lang].labelEmail;
document.getElementById('email').placeholder = texts[lang].placeholderEmail;
document.getElementById('labelProfession').textContent = texts[lang].labelProfession;
document.getElementById('profession').placeholder = texts[lang].placeholderProfession;
document.getElementById('labelSecteur').textContent = texts[lang].labelSecteur;
document.getElementById('secteur').placeholder = texts[lang].placeholderSecteur;
document.getElementById('labelEglise').textContent = texts[lang].labelEglise;
document.getElementById('eglise').placeholder = texts[lang].placeholderEglise;
document.getElementById('labelPasteur').textContent = texts[lang].labelPasteur;
document.getElementById('pasteur').placeholder = texts[lang].placeholderPasteur;
document.getElementById('labelMessage').textContent = texts[lang].labelMessage;
document.getElementById('nextBtn').textContent = texts[lang].nextBtn;

// Remplir select dynamiquement
const messageSelect = document.getElementById('message');
texts[lang].messageOptions.forEach(opt=>{
    const option = document.createElement('option');
    option.textContent = opt;
    messageSelect.appendChild(option);
});
</script>
</body>
</html>
    `);
});



app.get("/profil/adhesion-3", (req, res) => {
    res.send(`
<html>
<head>
<meta charset="UTF-8">
<title>Adhésion — ASSHA</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
* { box-sizing: border-box; }
body { margin:0; padding:0; font-family: Arial, sans-serif; background:#eef2f9; }

header {
    position: fixed;
    top:0; left:0; right:0;
    height:60px; 
    background:#0b57d0; 
    display:flex; 
    align-items:center; 
    padding:0 20px;
    z-index:1000;
}
header img { height:40px; border-radius:8px; margin-right:10px; }
header h1 { color:white; font-size:22px; margin:0; flex:1; }

.card { 
    width:100%; 
    max-width:650px; 
    background:white; 
    border-radius:18px; 
    padding:100px 25px 40px; 
    box-shadow:0 10px 25px rgba(0,0,0,0.12); 
    margin:0 auto;
    box-sizing:border-box;
    position:relative;
}

h1.card-title { text-align:center; color:#0b57d0; font-size:26px; margin-bottom:20px; }

.form-group { margin-bottom:15px; display:flex; flex-direction:column; }
label { margin-bottom:5px; font-weight:bold; color:#555; }
select {
    width:100%;
    padding:10px 12px;
    border-radius:8px;
    border:1px solid #ccc;
    font-size:15px;
    box-sizing:border-box;
}

.buttons { display:flex; justify-content:flex-end; margin-top:25px; }
a.btn { display:inline-block; text-decoration:none; text-align:center; color:white; background:#0b57d0; padding:8px 12px; border-radius:8px; font-size:16px; font-weight:bold; min-width:100px; }

#backFloating {
    position: fixed;
    bottom:20px;
    left:20px;
    display:flex;
    align-items:center;
    background:#555;
    color:white;
    padding:10px 14px;
    border-radius:12px;
    font-size:16px;
    text-decoration:none;
    z-index:1000;
    box-shadow:0 5px 15px rgba(0,0,0,0.2);
    transition: all 0.2s ease;
}
#backFloating:hover { background:#333; transform: scale(1.05); }

@media(max-width:480px){
    header h1{ font-size:18px; }
    .card{ padding:80px 15px 40px; }
    h1.card-title{ font-size:22px; }
    select{ font-size:14px; padding:8px 10px; }
    a.btn{ font-size:14px; padding:6px 10px; min-width:80px; }
    #backFloating{ font-size:14px; padding:8px 10px; }
}
</style>
</head>
<body>

<header>
    <img src="/img/log2.jpg" alt="ASSHA">
    <h1>ASSHA</h1>
</header>

<div class="card">
<h1 class="card-title" id="pageTitle">Étape 3 — Type de membre</h1>
<form>
    <div class="form-group">
        <label for="membership" id="labelMembership">Type de membre</label>
        <select id="membership"></select>
    </div>
    <div class="form-group">
        <label for="contribution" id="labelContribution">Contribution mensuelle</label>
        <select id="contribution"></select>
    </div>
    <div class="form-group">
        <label for="conditions" id="labelConditions">Conditions du membre</label>
        <select id="conditions"></select>
    </div>
    <div class="buttons">
        <a href="/profil/profils2" class="btn next" id="nextBtn">Terminer</a>
    </div>
</form>
</div>

<a href="/profil/adhesion-2" id="backFloating">&#8592; Retour</a>

<script>
const lang = localStorage.getItem('lang') || 'fr';
const texts = {
    fr: {
        pageTitle:"Étape 3 — Type de membre",
        labelMembership:"Type de membre",
        labelContribution:"Contribution mensuelle",
        labelConditions:"Conditions du membre",
        membershipOptions:["Membre honoraire","Sympathisant","Membre à part entière"],
        contributionOptions:["10 USD","20 USD","30 USD","40 USD","50 USD","100 USD","200 USD","300 USD","400 USD","500 USD"],
        conditionsOptions:["Oui"],
        nextBtn:"Terminer"
    },
    en: {
        pageTitle:"Step 3 — Membership Type",
        labelMembership:"Membership As",
        labelContribution:"Monthly contribution",
        labelConditions:"Membership conditions",
        membershipOptions:["Honorary Member","Sympathizer","Full Member"],
        contributionOptions:["10 USD","20 USD","30 USD","40 USD","50 USD","100 USD","200 USD","300 USD","400 USD","500 USD"],
        conditionsOptions:["Yes"],
        nextBtn:"Done"
    }
};

// Labels et boutons
document.getElementById('pageTitle').textContent = texts[lang].pageTitle;
document.getElementById('labelMembership').textContent = texts[lang].labelMembership;
document.getElementById('labelContribution').textContent = texts[lang].labelContribution;
document.getElementById('labelConditions').textContent = texts[lang].labelConditions;
document.getElementById('nextBtn').textContent = texts[lang].nextBtn;

// Remplir les selects dynamiquement
const membershipSelect = document.getElementById('membership');
texts[lang].membershipOptions.forEach(opt=>{ 
    const option=document.createElement('option'); 
    option.textContent=opt; 
    membershipSelect.appendChild(option); 
});

const contributionSelect = document.getElementById('contribution');
texts[lang].contributionOptions.forEach(opt=>{ 
    const option=document.createElement('option'); 
    option.textContent=opt; 
    contributionSelect.appendChild(option); 
});

const conditionsSelect = document.getElementById('conditions');
texts[lang].conditionsOptions.forEach(opt=>{ 
    const option=document.createElement('option'); 
    option.textContent=opt; 
    conditionsSelect.appendChild(option); 
});
</script>
</body>
</html>
    `);
});




app.get("/forum", (req, res) => {
    if (!req.session.user) return res.redirect("/login");

    const db = require("./config/db"); 
    const userId = req.session.user.id;

    const getData = async () => {
        const [events] = await db.promise().query(`
            SELECT e.id, e.title, e.image
            FROM events e
            ORDER BY e.date_event DESC LIMIT 10
        `);

        const [topics] = await db.promise().query(`
            SELECT f.id, f.title, f.content, f.user_id, f.created_at, COUNT(c.id) AS comments_count, u.prenom 
            FROM forum_topics f 
            LEFT JOIN forum_comments c ON f.id=c.topic_id
            LEFT JOIN users u ON f.user_id=u.id
            GROUP BY f.id
            ORDER BY f.created_at DESC
        `);

        const [posts] = await db.promise().query(`
            SELECT p.id, p.texte, p.image, COUNT(c.id) AS comments_count 
            FROM posts p 
            LEFT JOIN comments c ON p.id=c.id_post 
            GROUP BY p.id 
            ORDER BY p.date_creation DESC LIMIT 10
        `);

        return { events, topics, posts };
    };

    getData().then(({ events, topics, posts }) => {
        res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Forum ASSHA</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
<style>
body { background:#f4f6fa; font-family:Segoe UI,Tahoma,Geneva,Verdana,sans-serif; margin:0; padding:0; }

.section { background:white; border-radius:15px; padding:20px; margin-bottom:20px; }
.section h2 { color:#0b57d0; margin-bottom:15px; }

.slider { display:flex; overflow-x:auto; scroll-behavior:smooth; -ms-overflow-style:none; scrollbar-width:none; gap:15px; }
.slider::-webkit-scrollbar { display:none; }

.card-custom { background:#eef2f9; padding:15px; border-radius:12px; flex:0 0 auto; width:220px; position:relative; cursor:pointer; transition:0.3s; display:flex; flex-direction:column; }
.card-custom img { width:100%; height:120px; object-fit:cover; border-radius:12px; margin-bottom:10px; }
.card-title { font-weight:bold; font-size:0.95rem; display:flex; justify-content:space-between; align-items:center; }
.card-title span { background-color:#28a745; color:#fff; font-size:0.75rem; font-weight:600; padding:2px 6px; border-radius:12px; margin-left:6px; }
.card-content { font-size:0.85rem; color:#555; flex:1; margin-bottom:5px; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; }
.card-user { font-size:0.8rem; color:#555; text-align:right; margin-top:auto; }
.card-custom:hover { transform:translateY(-3px); box-shadow:0 6px 18px rgba(0,0,0,0.15); }

@media(max-width:768px){ 
    .card-custom { flex:0 0 auto; width:80%; max-width:260px; } 
}
@media(max-width:480px){ 
    .card-custom { flex:0 0 auto; width:90%; max-width:260px; } 
}

.modal-img { max-width:100%; height:auto; display:block; margin:auto; }
</style>
</head>
<body>

<!-- NAVBAR -->
<nav class="navbar navbar-expand-lg navbar-dark bg-primary shadow">
<div class="container-fluid">
<a class="navbar-brand fw-bold d-flex align-items-center" href="/forum">
<img src="/img/log2.jpg" style="height:40px;border-radius:50%;margin-right:10px;">ASSHA
</a>
<button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarContent">
<span class="navbar-toggler-icon"></span>
</button>
<div class="collapse navbar-collapse" id="navbarContent">
<ul class="navbar-nav me-auto">
<li class="nav-item"><a class="nav-link" href="/poster-video" data-i18n="postVideo"></a></li>
<li class="nav-item dropdown">
  <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="forum"></a>
  <ul class="dropdown-menu">
    <li><a class="dropdown-item" href="/forum/new-topic" data-i18n="newTopic"></a></li>
    <li><a class="dropdown-item" href="/forum/topics" data-i18n="viewTopics"></a></li>
    <li><a class="dropdown-item" href="/forum/my-topics" data-i18n="myTopics"></a></li>
  </ul>
</li>
<li class="nav-item dropdown">
  <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="payment"></a>
  <ul class="dropdown-menu">
    <li><a class="dropdown-item" href="/paiement/contribution" data-i18n="contribution"></a></li>
    <li><a class="dropdown-item" href="/paiement/donation" data-i18n="donation"></a></li>
    <li><a class="dropdown-item" href="/paiement/journal" data-i18n="journal"></a></li>
  </ul>
</li>
<li class="nav-item dropdown">
  <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="publication"></a>
  <ul class="dropdown-menu">
    <li><a class="dropdown-item" href="/publication/social" data-i18n="social"></a></li>
  </ul>
</li>
<li class="nav-item dropdown">
  <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="contact"></a>
  <ul class="dropdown-menu">
    <li><a class="dropdown-item" href="/contact/send-mail" data-i18n="sendMail"></a></li>
  </ul>
</li>
<li class="nav-item"><a class="nav-link" href="/bibliotheque" data-i18n="library"></a></li>
</ul>
<div class="me-3">
<button class="btn btn-light btn-sm" onclick="setLang('fr')">FR</button>
<button class="btn btn-light btn-sm" onclick="setLang('en')">EN</button>
</div>
<button class="btn btn-danger btn-sm" onclick="logout()" data-i18n="logout"></button>
</div></div>
</nav>

<div class="container mt-4">

<!-- EVENEMENTS -->
<div class="section">
<h2 data-i18n="events"></h2>
<div class="slider" id="eventsSlider">
${events.map(e=>`
  <div class="card-custom" onclick="openImageModal('/img/${e.image}')">
    <img src="/img/${e.image}" alt="${e.title}">
    <div class="card-title">${e.title}</div>
  </div>`).join('')}
</div>
</div>

<!-- SUJETS -->
<div class="section">
<h2 data-i18n="topics"></h2>
<div class="slider" id="topicsSlider">
${topics.map(t=>`
  <div class="card-custom" onclick="location.href='/forum/topic/${t.id}'">
    <div class="card-title">${t.title}<span>${t.comments_count}</span></div>
    <div class="card-content">${t.content}</div>
    <div class="card-user">par ${t.prenom}</div>
  </div>`).join('')}
</div>
</div>

<!-- PUBLICATIONS -->
<div class="section">
<h2 data-i18n="recentPosts"></h2>
<div class="slider" id="postsSlider">
${posts.map(p=>`
  <div class="card-custom" onclick="location.href='/publication/post/${p.id}'">
    <img src="/img/${p.image}" alt="Publication">
    <div class="card-title">${p.texte.substring(0,50)}<span>${p.comments_count}</span></div>
  </div>`).join('')}
</div>
</div>

</div>

<div class="modal fade" id="imgModal" tabindex="-1">
<div class="modal-dialog modal-dialog-centered modal-lg">
<div class="modal-content">
<div class="modal-body p-0">
<img id="modalImage" class="modal-img">
</div>
<button type="button" class="btn-close position-absolute top-0 end-0 m-2" data-bs-dismiss="modal"></button>
</div>
</div>
</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
<script>
const t = { fr:{postVideo:"Poster vidéo", forum:"Forum", newTopic:"Poster un sujet", viewTopics:"Consulter les sujets", myTopics:"Mes sujets", payment:"Paiement", contribution:"Contribution", donation:"Faire un don", journal:"Journal", publication:"Publication", social:"Social", contact:"Contact", sendMail:"Envoyer un email", library:"Bibliothèque", logout:"Déconnexion", events:"Événements", topics:"Sujets du forum", recentPosts:"Publications récentes"}, en:{postVideo:"Post video", forum:"Forum", newTopic:"New topic", viewTopics:"View topics", myTopics:"My topics", payment:"Payment", contribution:"Contribution", donation:"Donate", journal:"Journal", publication:"Publication", social:"Social", contact:"Contact", sendMail:"Send email", library:"Library", logout:"Logout", events:"Events", topics:"Forum topics", recentPosts:"Recent posts"}};
let lang = localStorage.getItem("lang")||"fr";
function setLang(l){lang=l; localStorage.setItem("lang",l); applyLang();}
function applyLang(){document.querySelectorAll("[data-i18n]").forEach(e=>{e.innerText=t[lang][e.dataset.i18n];});}
applyLang();
function logout(){fetch("/logout").then(()=>location.href="/login");}

// Slider manuel seulement
function setupSlider(sliderId){
  const slider = document.getElementById(sliderId);
  if(!slider) return;
  let isDown=false, startX, scrollLeft;
  slider.addEventListener('mousedown', e=>{isDown=true; startX=e.pageX-slider.offsetLeft; scrollLeft=slider.scrollLeft;});
  slider.addEventListener('mouseleave', ()=>{isDown=false;});
  slider.addEventListener('mouseup', ()=>{isDown=false;});
  slider.addEventListener('mousemove', e=>{if(!isDown) return; e.preventDefault(); slider.scrollLeft=scrollLeft+(startX-e.pageX+slider.offsetLeft);});
}
setupSlider("eventsSlider");
setupSlider("topicsSlider");
setupSlider("postsSlider");

// Modal zoom
const imgModal = new bootstrap.Modal(document.getElementById('imgModal'));
function openImageModal(src){document.getElementById('modalImage').src=src; imgModal.show();}
</script>

</body>
</html>`);
    }).catch(err=>res.send("Erreur BDD: "+err));
});









app.get("/poster-video", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  db.query("SELECT * FROM videos ORDER BY created_at DESC", (err, videos) => {
    if (err) throw err;

    const cards = videos.map(v => `
      <div class="video-card" data-search="${v.title.toLowerCase()} ${v.description.toLowerCase()}">
        <div class="video-box">
          <video src="/uploads/${v.filename}" controls></video>
        </div>
        <div class="p-2">
          <h6>${v.title}</h6>
          <p>${v.description}</p>
          <div class="d-flex align-items-center gap-2">
            <button class="btn btn-outline-primary btn-sm like-btn" data-id="${v.id}">
              <span data-i18n="like">Like</span>
            </button>
            <span class="badge bg-secondary like-count">${v.likes}</span>
          </div>
        </div>
      </div>
    `).join("");

    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Bibliothèque des vidéos</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
<style>
body { background:#f4f6fa; margin:0; }
.container { max-width:1200px; margin:auto; padding:20px; }
.video-feed { display:flex; flex-direction:column; gap:15px; }
.video-card {
  background:#fff;
  border-radius:15px;
  box-shadow:0 5px 15px rgba(0,0,0,.1);
}
.video-box {
  position:relative;
  padding-top:56.25%;
  background:#000;
  overflow:hidden;
}
.video-box video {
  position:absolute;
  inset:0;
  width:100%;
  height:100%;
  object-fit:cover;
}
@media(min-width:992px){
  .video-feed {
    display:grid;
    grid-template-columns:repeat(auto-fit,minmax(260px,1fr));
    gap:20px;
  }
}
/* MODAL IOS */
.ios-backdrop {
  position:fixed;
  inset:0;
  background:rgba(0,0,0,.35);
  display:none;
  align-items:center;
  justify-content:center;
  z-index:9999;
}
.ios-modal {
  background:#fff;
  width:85%;
  max-width:320px;
  border-radius:18px;
  text-align:center;
  padding:20px;
  animation:pop .25s ease;
}
.ios-modal button {
  width:100%;
  background:#0b57d0;
  color:#fff;
  border:none;
  padding:10px;
  border-radius:12px;
  font-weight:600;
}
@keyframes pop {
  from { transform:scale(.9); opacity:0 }
  to { transform:scale(1); opacity:1 }
}
</style>
</head>
<body>

<!-- NAVBAR COMPLETE -->
<nav class="navbar navbar-expand-lg navbar-dark bg-primary shadow">
  <div class="container-fluid">
    <a class="navbar-brand fw-bold d-flex align-items-center" href="/forum">
      <img src="/img/log2.jpg" style="height:40px;border-radius:50%;margin-right:10px;">ASSHA
    </a>
    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarContent">
      <span class="navbar-toggler-icon"></span>
    </button>
    <div class="collapse navbar-collapse" id="navbarContent">
      <ul class="navbar-nav me-auto">
        <li class="nav-item"><a class="nav-link" href="/poster-video" data-i18n="nav_video">Bibliothèque vidéos</a></li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_forum">Forum</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item" href="/forum/new-topic" data-i18n="nav_post_topic">Poster un sujet</a></li>
            <li><a class="dropdown-item" href="/forum/topics" data-i18n="nav_view_topics">Consulter les sujets</a></li>
            <li><a class="dropdown-item" href="/forum/my-topics" data-i18n="nav_my_topics">Mes sujets</a></li>
          </ul>
        </li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_payment">Paiement</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item" href="/paiement/contribution">Contribution</a></li>
            <li><a class="dropdown-item" href="/paiement/donation">Faire un don</a></li>
            <li><a class="dropdown-item" href="/paiement/journal">Journal</a></li>
          </ul>
        </li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_publication">Publication</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item" href="/publication/social">Social</a></li>
          </ul>
        </li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_contact">Contact</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item" href="/contact/send-mail">Envoyer un email</a></li>
          </ul>
        </li>
        <li class="nav-item"><a class="nav-link" href="/bibliotheque">Bibliothèque</a></li>
      </ul>
    </div>
  </div>
</nav>

<div class="container">
  <h4 class="mb-3" data-i18n="library">Bibliothèque des vidéos</h4>
  <input class="form-control mb-3" id="search" data-i18n-placeholder="search" placeholder="Rechercher une vidéo...">
  <div class="video-feed">${cards}</div>
</div>

<!-- MODAL IOS -->
<div class="ios-backdrop" id="iosModal">
  <div class="ios-modal">
    <h6 data-i18n="alreadyLikedTitle">Action impossible</h6>
    <p data-i18n="alreadyLikedMsg">Vous avez déjà liké cette vidéo.</p>
    <button id="closeModal" data-i18n="okBtn">OK</button>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
<script>
// Traduction FR/EN
const i18n = {
  fr: {
    nav_video:"Bibliothèque vidéos",
    nav_forum:"Forum",
    nav_post_topic:"Poster un sujet",
    nav_view_topics:"Consulter les sujets",
    nav_my_topics:"Mes sujets",
    nav_payment:"Paiement",
    nav_publication:"Publication",
    nav_contact:"Contact",
    library:"Bibliothèque des vidéos",
    search:"Rechercher une vidéo...",
    like:"Like",
    alreadyLikedTitle:"Action impossible",
    alreadyLikedMsg:"Vous avez déjà liké cette vidéo.",
    okBtn:"OK"
  },
  en: {
    nav_video:"Videos",
    nav_forum:"Forum",
    nav_post_topic:"Post topic",
    nav_view_topics:"View topics",
    nav_my_topics:"My topics",
    nav_payment:"Payment",
    nav_publication:"Publication",
    nav_contact:"Contact",
    library:"Video Library",
    search:"Search a video...",
    like:"Like",
    alreadyLikedTitle:"Action not allowed",
    alreadyLikedMsg:"You already liked this video.",
    okBtn:"OK"
  }
};

function applyLang(){
  const lang = localStorage.getItem("lang") || "fr";
  document.querySelectorAll("[data-i18n]").forEach(el=>{
    const key = el.dataset.i18n;
    if(i18n[lang][key]) el.textContent = i18n[lang][key];
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el=>{
    const key = el.dataset.i18nPlaceholder;
    if(i18n[lang][key]) el.placeholder = i18n[lang][key];
  });
  document.querySelectorAll(".like-btn span").forEach(el=>{
    el.textContent = i18n[lang]["like"];
  });
}

applyLang();

// LIKE avec compteur
document.querySelectorAll(".like-btn").forEach(btn => {
  btn.onclick = () => {
    fetch("/video/like/" + btn.dataset.id, { method: "POST" })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          btn.querySelector(".like-count").innerText = d.likes;
          btn.classList.replace("btn-outline-primary", "btn-primary");
        } else {
          document.getElementById("iosModal").style.display = "flex";
        }
      });
  };
});

document.getElementById("closeModal").onclick = () => {
  document.getElementById("iosModal").style.display = "none";
};

// SEARCH
document.getElementById("search").oninput = e => {
  const v = e.target.value.toLowerCase();
  document.querySelectorAll(".video-card").forEach(c => {
    c.style.display = c.dataset.search.includes(v) ? "block" : "none";
  });
};
</script>
</body>
</html>`);
  });
});




app.post("/video/like/:id", (req, res) => {
  if (!req.session.user) return res.json({ success: false, message: "Non connecté" });

  const videoId = req.params.id;
  const userId = req.session.user.id; // l'ID de l'utilisateur connecté

  // Vérifier si l'utilisateur a déjà liké cette vidéo
  db.query("SELECT * FROM video_likes WHERE user_id = ? AND video_id = ?", [userId, videoId], (err, result) => {
    if (err) return res.json({ success: false });

    if (result.length > 0) {
      // L'utilisateur a déjà liké
      return res.json({ success: false, message: "Vous avez déjà liké cette vidéo" });
    }

    // Ajouter le like dans video_likes
    db.query("INSERT INTO video_likes (user_id, video_id) VALUES (?, ?)", [userId, videoId], (err) => {
      if (err) return res.json({ success: false });

      // Incrémenter le compteur dans la table videos
      db.query("UPDATE videos SET likes = likes + 1 WHERE id = ?", [videoId], (err) => {
        if (err) return res.json({ success: false });

        // Récupérer le nouveau nombre de likes
        db.query("SELECT likes FROM videos WHERE id = ?", [videoId], (err, result2) => {
          if (err) return res.json({ success: false });
          res.json({ success: true, likes: result2[0].likes });
        });
      });
    });
  });
});
















app.get("/forum/new-topic", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Poster un sujet</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
<style>
body { background:#f4f6fa; font-family:"Segoe UI", Tahoma, Geneva, Verdana, sans-serif; margin:0; padding:0; }

.section { background:white; border-radius:15px; padding:20px; margin:20px auto; max-width:700px; box-shadow:0 5px 15px rgba(0,0,0,0.1); }

.image-top img {
  width: 100%;            /* largeur pleine section */
  max-height: 200px;      /* hauteur maximale */
  height: auto;            /* proportion conservée */
  object-fit: cover;       /* recadrage si nécessaire */
  border-radius: 15px 15px 0 0;
  display: block;
  margin-bottom: 15px;
}

.input-container { background:#e6f0ff; border-radius:12px; padding:15px; display:flex; flex-direction:column; gap:15px; }
.input-container input, .input-container textarea { border:1px solid #ccc; border-radius:10px; padding:10px; font-size:0.95rem; width:100%; resize:none; }
.btn-primary { background:#0d6efd; border:none; }

.modal-ios { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #fff; border-radius: 15px; width: 90%; max-width: 320px; padding: 20px; box-shadow: 0 5px 15px rgba(0,0,0,0.3); display: none; z-index: 1000; text-align: center; }
.modal-ios h4 { margin-bottom: 15px; font-size: 1rem; }
.modal-ios .btns { display: flex; justify-content: space-around; margin-top: 10px; }
.modal-ios .btn { padding: 6px 12px; border-radius: 10px; border: none; cursor: pointer; font-weight: 500; }
.modal-ios .btn.cancel { background: #ccc; color: #000; }
.modal-ios .btn.confirm { background: #0d6efd; color: #fff; }
.modal-backdrop { position: fixed; top:0; left:0; right:0; bottom:0; background: rgba(0,0,0,0.4); z-index: 999; display: none; }

@media(max-width:768px){ .section { margin:15px; padding:15px; } }
</style>
</head>
<body>

<nav class="navbar navbar-expand-lg navbar-dark bg-primary shadow">
  <div class="container-fluid">
    <a class="navbar-brand fw-bold d-flex align-items-center" href="/forum">
      <img src="/img/log2.jpg" style="height:40px;border-radius:50%;margin-right:10px;">ASSHA
    </a>
    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarContent">
      <span class="navbar-toggler-icon"></span>
    </button>
    <div class="collapse navbar-collapse" id="navbarContent">
      <ul class="navbar-nav me-auto">
        <li class="nav-item"><a class="nav-link" href="/poster-video" data-i18n="nav_video">Poster vidéo</a></li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_forum">Forum</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item" href="/forum/new-topic" data-i18n="nav_post_topic">Poster un sujet</a></li>
            <li><a class="dropdown-item" href="/forum/topics" data-i18n="nav_view_topics">Consulter les sujets</a></li>
            <li><a class="dropdown-item" href="/forum/my-topics" data-i18n="nav_my_topics">Mes sujets</a></li>
          </ul>
        </li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_payment">Paiement</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item" href="/paiement/contribution">Contribution</a></li>
            <li><a class="dropdown-item" href="/paiement/donation">Faire un don</a></li>
            <li><a class="dropdown-item" href="/paiement/journal">Journal</a></li>
          </ul>
        </li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_publication">Publication</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item" href="/publication/social">Social</a></li>
          </ul>
        </li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_contact">Contact</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item" href="/contact/send-mail">Envoyer un email</a></li>
          </ul>
        </li>
        <li class="nav-item"><a class="nav-link" href="/bibliotheque">Bibliothèque</a></li>
      </ul>
    </div>
  </div>
</nav>

<div class="section">

  <!-- IMAGE AU-DESSUS DE LA CARTE -->
  <div class="image-top">
    <img src="/img/for.jpg" alt="Image du sujet">
  </div>

  <h2 data-i18n="new_topic_title">Poster un sujet</h2>
  <form id="newTopicForm">
    <div class="input-container">
      <input type="text" id="title" name="title" 
             placeholder="Entrez le titre de votre sujet" 
             data-i18n-placeholder="topic_title_placeholder" maxlength="150" required>
      <textarea id="content" name="content" rows="5" 
                placeholder="Écrivez votre message ici" 
                data-i18n-placeholder="topic_content_placeholder" required></textarea>
    </div>
    <button type="submit" class="btn btn-primary mt-3" data-i18n="publish_btn">Publier</button>
  </form>
</div>

<div class="modal-backdrop" id="modalBackdrop"></div>
<div class="modal-ios" id="modalIOS">
  <h4 id="modalTitle">Sujet publié</h4>
  <p id="modalMessage">Votre sujet a été publié avec succès.</p>
  <div class="btns">
    <button class="btn cancel" onclick="closeModal()">Rester ici</button>
    <button class="btn confirm" id="goToTopicsBtn">Consulter les sujets</button>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
<script>
// Traduction FR/EN
const i18n = {
  fr: { nav_video:"Poster vidéo", nav_forum:"Forum", nav_post_topic:"Poster un sujet", nav_view_topics:"Consulter les sujets", nav_my_topics:"Mes sujets", new_topic_title:"Poster un sujet", topic_title_placeholder:"Entrez le titre de votre sujet", topic_content_placeholder:"Écrivez votre message ici", publish_btn:"Publier", modal_title:"Sujet publié", modal_msg:"Votre sujet a été publié avec succès.", modal_confirm:"Consulter les sujets", modal_cancel:"Rester ici" },
  en: { nav_video:"Post Video", nav_forum:"Forum", nav_post_topic:"Post topic", nav_view_topics:"View topics", nav_my_topics:"My topics", new_topic_title:"Post a Topic", topic_title_placeholder:"Enter your topic title", topic_content_placeholder:"Write your message here", publish_btn:"Publish", modal_title:"Topic Posted", modal_msg:"Your topic has been successfully posted.", modal_confirm:"View Topics", modal_cancel:"Stay Here" }
};

function applyLang() {
  const lang = localStorage.getItem("lang") || "fr";
  document.querySelectorAll("[data-i18n]").forEach(el=>{ const key = el.dataset.i18n; if(i18n[lang][key]) el.textContent = i18n[lang][key]; });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el=>{ const key = el.dataset.i18nPlaceholder; if(i18n[lang][key]) el.placeholder = i18n[lang][key]; });
  document.getElementById("modalTitle").textContent = i18n[lang].modal_title;
  document.getElementById("modalMessage").textContent = i18n[lang].modal_msg;
  document.getElementById("goToTopicsBtn").textContent = i18n[lang].modal_confirm;
  document.querySelector("#modalIOS .btn.cancel").textContent = i18n[lang].modal_cancel;
}
applyLang();

// Modal functions
const modal = document.getElementById("modalIOS");
const backdrop = document.getElementById("modalBackdrop");
const goToTopicsBtn = document.getElementById("goToTopicsBtn");

function openModal() { modal.style.display='block'; backdrop.style.display='block'; }
function closeModal() { modal.style.display='none'; backdrop.style.display='none'; }
goToTopicsBtn.addEventListener("click", ()=>{ window.location.href="/forum/topics"; });

// Formulaire
const form = document.getElementById("newTopicForm");
form.addEventListener("submit", function(e){
  e.preventDefault();
  const formData = new FormData(form);
  fetch("/forum/new-topic", { method: "POST", body: new URLSearchParams(formData) })
    .then(res => res.text())
    .then(data => { form.reset(); openModal(); })
    .catch(err => { alert("Erreur lors de la publication du sujet."); console.error(err); });
});
</script>

</body>
</html>`);
});





app.get("/forum/topics", (req, res) => { 
  if (!req.session.user) return res.redirect("/login");

  const sql = `
    SELECT f.id, f.title, f.content, f.created_at, u.avatars, u.prenom,
           COUNT(c.id) AS comment_count
    FROM forum_topics f
    LEFT JOIN users u ON f.user_id = u.id
    LEFT JOIN forum_comments c ON c.topic_id = f.id
    GROUP BY f.id
    ORDER BY f.created_at DESC
  `;

  db.query(sql, (err, results) => {
    if (err) return res.send("Erreur lors de la récupération des sujets : " + err);

    const cards = results.map(topic => `
      <div class="col-md-6 col-lg-4 library-card-wrapper" data-title="${topic.title.toLowerCase()}" data-content="${topic.content.toLowerCase()}">
        <div class="library-card" onclick="window.location.href='/forum/topic/${topic.id}'">
          <div class="card-header-custom">
            <img src="/img/xxx.png" class="avatar">
            <h6 class="title text-truncate">${topic.title}</h6>
            <span class="badge-comment">${topic.comment_count}</span>
          </div>
          <div class="content-bubble">${topic.content}</div>
          <div class="card-footer-custom">
            <small data-i18n="publishedBy">Publié par</small> ${topic.prenom || 'Utilisateur inconnu'} <small>${new Date(topic.created_at).toLocaleString()}</small>
          </div>
        </div>
      </div>
    `).join("");

    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Consulter tous les sujets</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
<style>
body { background:#f4f6fa; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto; }
.navbar-brand img { height:38px; border-radius:50%; margin-right:8px; }
.library-card-wrapper { margin-bottom:15px; }
.library-card { background:#fff; border-radius:18px; padding:14px; display:flex; flex-direction:column; box-shadow:0 8px 20px rgba(0,0,0,.06); height:250px; overflow:hidden; cursor:pointer; transition:all 0.3s ease; }
.library-card:hover { transform:translateY(-2px); }
.card-header-custom { display:flex; align-items:center; gap:10px; margin-bottom:10px; position:relative; }
.avatar { width:42px; height:42px; border-radius:50%; object-fit:cover; }
.title { font-size:0.9rem; font-weight:600; flex:1; }
.badge-comment { background: #28a745; color: #fff; font-size:0.75rem; font-weight:600; padding:5px 10px; border-radius:50%; box-shadow: 0 2px 6px rgba(0,0,0,0.2); display:flex; align-items:center; justify-content:center; }
.content-bubble { background:#e8f2ff; border-radius:14px; padding:12px; font-size:0.85rem; color:#333; flex:1 1 auto; overflow:hidden; display:-webkit-box; -webkit-line-clamp:5; -webkit-box-orient:vertical; }
.card-footer-custom { display:flex; flex-direction:column; gap:6px; margin-top:8px; }
.card-footer-custom small { font-size:0.7rem; color:#888; }
#searchInput { margin-bottom:15px; }
</style>
</head>
<body>

<nav class="navbar navbar-expand-lg navbar-dark bg-primary shadow">
  <div class="container-fluid">
    <a class="navbar-brand fw-bold d-flex align-items-center" href="/forum">
      <img src="/img/log2.jpg" style="height:40px;border-radius:50%;margin-right:10px;">ASSHA
    </a>
    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarContent">
      <span class="navbar-toggler-icon"></span>
    </button>
    <div class="collapse navbar-collapse" id="navbarContent">
      <ul class="navbar-nav me-auto">
        <li class="nav-item"><a class="nav-link" href="/poster-video" data-i18n="nav_video">Poster vidéo</a></li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_forum">Forum</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item" href="/forum/new-topic" data-i18n="nav_post_topic">Poster un sujet</a></li>
            <li><a class="dropdown-item" href="/forum/topics" data-i18n="nav_view_topics">Consulter les sujets</a></li>
            <li><a class="dropdown-item" href="/forum/my-topics" data-i18n="nav_my_topics">Mes sujets</a></li>
          </ul>
        </li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_payment">Paiement</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item" href="/paiement/contribution">Contribution</a></li>
            <li><a class="dropdown-item" href="/paiement/donation">Faire un don</a></li>
            <li><a class="dropdown-item" href="/paiement/journal">Journal</a></li>
          </ul>
        </li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_publication">Publication</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item" href="/publication/social">Social</a></li>
          </ul>
        </li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_contact">Contact</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item" href="/contact/send-mail">Envoyer un email</a></li>
          </ul>
        </li>
        <li class="nav-item"><a class="nav-link" href="/bibliotheque">Bibliothèque</a></li>
      </ul>
    </div>
  </div>
</nav>

<div class="container mt-4">
  <h3 class="mb-3" data-i18n="allTopics">Tous les sujets</h3>
  <input type="text" id="searchInput" class="form-control" placeholder="Rechercher un sujet...">
  <div class="row g-3" id="topicsContainer">
    ${cards || "<p>Aucun sujet.</p>"}
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
<script>
// Lecture du localStorage pour la langue
const lang = localStorage.getItem("lang") || "fr";

const translations = {
  fr: {
    nav_video:"Poster vidéo",
    nav_forum:"Forum",
    nav_post_topic:"Poster un sujet",
    nav_view_topics:"Consulter les sujets",
    nav_my_topics:"Mes sujets",
    nav_payment:"Paiement",
    nav_publication:"Publication",
    nav_contact:"Contact",
    allTopics:"Tous les sujets",
    publishedBy:"Publié par"
  },
  en: {
    nav_video:"Post video",
    nav_forum:"Forum",
    nav_post_topic:"New topic",
    nav_view_topics:"View topics",
    nav_my_topics:"My topics",
    nav_payment:"Payment",
    nav_publication:"Publication",
    nav_contact:"Contact",
    allTopics:"All topics",
    publishedBy:"Published by"
  }
};

document.querySelectorAll("[data-i18n]").forEach(el=>{
  const key = el.dataset.i18n;
  if(translations[lang][key]) el.innerText = translations[lang][key];
});

// Recherche instantanée
const searchInputEl = document.getElementById("searchInput");
searchInputEl.addEventListener("input", ()=>{
  const query = searchInputEl.value.toLowerCase();
  document.querySelectorAll(".library-card-wrapper").forEach(card=>{
    const title = card.dataset.title;
    const content = card.dataset.content;
    card.style.display = (title.includes(query) || content.includes(query)) ? "block" : "none";
  });
});
</script>

</body>
</html>`);
  });
});






app.get("/forum/topic/:id", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const user = req.session.user;
  const topicId = req.params.id;

  const topicSql = `
    SELECT 
      f.id,
      f.title,
      f.content,
      f.created_at,
      u.avatars,
      u.prenom AS author_name
    FROM forum_topics f
    LEFT JOIN users u ON f.user_id = u.id
    WHERE f.id = ?
  `;

  db.query(topicSql, [topicId], (err, topicResults) => {
    if (err) return res.send("Erreur récupération sujet");
    if (!topicResults.length) return res.send("Sujet introuvable");

    const topic = topicResults[0];

    const commentsSql = `
      SELECT 
        c.id,
        c.content,
        c.created_at,
        c.user_id,
        u.avatars,
        u.prenom
      FROM forum_comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.topic_id = ?
      ORDER BY c.created_at ASC
    `;

    db.query(commentsSql, [topicId], (err, comments) => {
      if (err) return res.send("Erreur commentaires");

      // Fonction pour échapper les caractères spéciaux
      const escapeHtml = (text) => {
        if (!text) return "";
        return text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;")
          .replace(/`/g, "&#96;");
      };

      const commentsHTML = comments.map(c => {
        const isMine = c.user_id === user.id;
        const hour = new Date(c.created_at)
          .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

        return `
        <div class="message-card ${isMine ? "my-message" : ""}" data-comment-id="${c.id}">
          ${!isMine ? `<img src="/img/xxx.png" class="avatar">` : ""}
          <div class="message-content">
            ${!isMine ? `<strong>${escapeHtml(c.prenom || "Utilisateur")}</strong>` : ""}
            <p class="message-text">${escapeHtml(c.content)}</p>
            <div class="message-footer">
              <small>${hour}</small>
              ${isMine ? `
              <div class="comment-actions">
                <button class="edit-btn"><i class="fas fa-pen"></i></button>
                <button class="delete-btn"><i class="fas fa-trash"></i></button>
              </div>` : ""}
            </div>
          </div>
        </div>`;
      }).join("") || `<p style="text-align:center">Aucun commentaire</p>`;

      res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(topic.title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
<style>
body {margin:0;height:100vh;display:flex;flex-direction:column;background:#f0f2f5;font-family:Segoe UI,sans-serif;}
.chat-container {flex:1;display:flex;flex-direction:column;background:#fff;}
.topic-header {display:flex;align-items:center;gap:10px;padding:10px;background:#fff;border-bottom:1px solid #ddd;}
.topic-header img {width:36px;height:36px;border-radius:50%;}
.topic-header strong {max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:inline-block;vertical-align:middle;}
.topic-header small {font-size:.75rem;color:#6c757d;}
.messages-scroll {flex:1;padding:12px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;background-color:#f5f5f5;border-radius:12px 12px 0 0;}
.message-card {display:flex;gap:8px;padding:6px 10px;background:#fff;border-radius:12px;max-width:220px;box-shadow:0 1px 2px rgba(0,0,0,.08);}
.message-card.my-message {align-self:flex-end;background:#0d6efd;color:#fff;flex-direction:row-reverse;}
.avatar {width:34px;height:34px;border-radius:50%;}
.message-content p {margin:2px 0;font-size:.9rem;}
.message-footer {display:flex;justify-content:space-between;align-items:center;font-size:.7rem;margin-top:2px;}
.comment-actions {display:flex;gap:6px;}
.comment-actions button {background:none;border:none;color:inherit;font-size:.75rem;cursor:pointer;}
.input-area {display:flex;gap:8px;padding:10px;border-top:1px solid #ddd;}
.input-area input {flex:1;border-radius:18px;padding:8px 14px;border:1px solid #ccc;}
.input-area button {width:38px;height:38px;border-radius:50%;background:#0d6efd;border:none;color:#fff;}
.modal {display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);justify-content:center;align-items:center;}
.modal-content {background:#fff;padding:20px;border-radius:10px;max-width:400px;width:90%;}
</style>
</head>
<body>

<div class="chat-container">
  <div class="topic-header">
    <button onclick="history.back()" class="btn btn-sm btn-light"><i class="fas fa-arrow-left"></i></button>
    <img src="/img/xxx.png">
    <div>
      <strong>${escapeHtml(topic.title)}</strong><br>
      <small>${escapeHtml(topic.author_name || "Utilisateur")}</small>
    </div>
  </div>

  <div class="messages-scroll" id="messages">
    ${commentsHTML}
  </div>

  <div class="input-area">
    <input id="msg" placeholder="Répondre au sujet...">
    <button id="send"><i class="fas fa-paper-plane"></i></button>
  </div>
</div>

<!-- Modals édition/suppression -->
<div class="modal" id="editModal">
  <div class="modal-content">
    <h5>Modifier le commentaire</h5>
    <textarea id="editContent" style="width:100%;height:80px;margin:10px 0;"></textarea>
    <div style="text-align:right;">
      <button id="cancelEdit" class="btn btn-secondary btn-sm">Annuler</button>
      <button id="saveEdit" class="btn btn-primary btn-sm">Enregistrer</button>
    </div>
  </div>ù
</div>

<div class="modal" id="deleteModal">
  <div class="modal-content">
    <h5>Supprimer le commentaire ?</h5>
    <div style="text-align:right;margin-top:10px;">
      <button id="cancelDelete" class="btn btn-secondary btn-sm">Annuler</button>
      <button id="confirmDelete" class="btn btn-danger btn-sm">Supprimer</button>
    </div>
  </div>
</div>

<script>
const msg=document.getElementById("msg");
const send=document.getElementById("send");
const messages=document.getElementById("messages");
let currentCommentId=null;
const editModal=document.getElementById("editModal");
const editContent=document.getElementById("editContent");
const cancelEdit=document.getElementById("cancelEdit");
const saveEdit=document.getElementById("saveEdit");
const deleteModal=document.getElementById("deleteModal");
const cancelDelete=document.getElementById("cancelDelete");
const confirmDelete=document.getElementById("confirmDelete");

// Envoi d'un nouveau message
send.onclick=()=>{
  const text=msg.value.trim();
  if(!text)return;
  fetch("/forum/topic/${topic.id}/comment",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content:text})})
  .then(r=>r.json()).then(d=>{
    if(d.success){
      const hour=new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
      messages.insertAdjacentHTML("beforeend",\`
      <div class="message-card my-message" data-user-id="${user.id}">
        <div class="message-content">
          <p class="message-text">\${text}</p>
          <div class="message-footer">
            <small>\${hour}</small>
            <div class="comment-actions">
              <button class="edit-btn"><i class="fas fa-pen"></i></button>
              <button class="delete-btn"><i class="fas fa-trash"></i></button>
            </div>
          </div>
        </div>
      </div>\`);
      msg.value="";messages.scrollTop=messages.scrollHeight;
    }
  });
};

msg.addEventListener("keypress",e=>{if(e.key==="Enter")send.click();});

// Gestion des modals edit/delete
messages.addEventListener("click",e=>{
  if(e.target.closest(".edit-btn")){
    const card=e.target.closest(".message-card");
    currentCommentId=card.dataset.commentId;
    editContent.value=card.querySelector(".message-text").textContent;
    editModal.style.display="flex";
  }
  if(e.target.closest(".delete-btn")){
    const card=e.target.closest(".message-card");
    currentCommentId=card.dataset.commentId;
    deleteModal.style.display="flex";
  }
});

cancelEdit.onclick=()=>{editModal.style.display="none"; currentCommentId=null;};
saveEdit.onclick=()=>{
  const content=editContent.value.trim();
  if(!content)return alert("Contenu vide");
  fetch(\`/forum/comment/\${currentCommentId}\`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({content})})
  .then(r=>r.json()).then(d=>{
    if(d.success){
      const card=messages.querySelector(\`.message-card[data-comment-id='\${currentCommentId}']\`);
      card.querySelector(".message-text").textContent=content;
      editModal.style.display="none"; currentCommentId=null;
    }else alert(d.message);
  });
};

cancelDelete.onclick=()=>{deleteModal.style.display="none"; currentCommentId=null;};
confirmDelete.onclick=()=>{
  fetch(\`/forum/comment/\${currentCommentId}\`,{method:"DELETE"})
  .then(r=>r.json()).then(d=>{
    if(d.success){
      const card=messages.querySelector(\`.message-card[data-comment-id='\${currentCommentId}']\`);
      card.remove(); deleteModal.style.display="none"; currentCommentId=null;
    }else alert(d.message);
  });
};

[editModal, deleteModal].forEach(modal=>{
  modal.addEventListener("click",e=>{if(e.target===modal){modal.style.display="none"; currentCommentId=null;}});
});
</script>

</body>
</html>`);
    });
  });
});







app.post("/forum/topic/:id/comment", (req, res) => {
  if (!req.session.user) {
    return res.json({ success: false, message: "Non connecté" });
  }

  const topicId = req.params.id;
  const content = req.body.content?.trim();
  const userId = req.session.user.id;

  if (!content) {
    return res.json({ success: false, message: "Commentaire vide" });
  }

  const sql = `
    INSERT INTO forum_comments (topic_id, user_id, content, created_at)
    VALUES (?, ?, ?, NOW())
  `;

  db.query(sql, [topicId, userId, content], (err, result) => {
    if (err) {
      return res.json({ success: false, message: err });
    }

    res.json({
      success: true,
      commentId: result.insertId,
      hour: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    });
  });
});

app.put("/forum/comment/:id", (req, res) => {
  if (!req.session.user) {
    return res.json({ success: false, message: "Non connecté" });
  }

  const commentId = req.params.id;
  const content = req.body.content?.trim();
  const userId = req.session.user.id;

  if (!content) {
    return res.json({ success: false, message: "Contenu vide" });
  }

  const sql = `
    UPDATE forum_comments
    SET content = ?
    WHERE id = ? AND user_id = ?
  `;

  db.query(sql, [content, commentId, userId], (err, result) => {
    if (err) {
      return res.json({ success: false, message: err });
    }

    if (result.affectedRows === 0) {
      return res.json({ success: false, message: "Action refusée" });
    }

    res.json({ success: true });
  });
});

app.delete("/forum/comment/:id", (req, res) => {
  if (!req.session.user) {
    return res.json({ success: false, message: "Non connecté" });
  }

  const commentId = req.params.id;
  const userId = req.session.user.id;

  const sql = `
    DELETE FROM forum_comments
    WHERE id = ? AND user_id = ?
  `;

  db.query(sql, [commentId, userId], (err, result) => {
    if (err) {
      return res.json({ success: false, message: err });
    }

    if (result.affectedRows === 0) {
      return res.json({ success: false, message: "Action refusée" });
    }

    res.json({ success: true });
  });
});





app.get("/forum/my-topics", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const userId = req.session.user.id;
  const sql = `
    SELECT id, title, content, created_at
    FROM forum_topics
    WHERE user_id = ? AND status = 'active'
    ORDER BY created_at DESC
  `;

  db.query(sql, [userId], (err, topics) => {
    if (err) return res.send("Erreur serveur");

    const cards = topics.map(t => `
      <div class="col-md-6 col-lg-4 library-card-wrapper" data-title="${t.title.toLowerCase()}" data-content="${t.content.toLowerCase()}">
        <div class="library-card">
          <div class="card-header-custom">
            <img src="/img/xxx.png" class="avatar">
            <h6 class="title text-truncate">${t.title}</h6>
          </div>
          <div class="content-bubble">${t.content}</div>
          <div class="card-footer-custom">
            <small>${new Date(t.created_at).toLocaleString()}</small>
            <div class="actions">
              <button class="btn-action edit-btn" data-id="${t.id}" data-title="${t.title}" data-content="${t.content}">✏️</button>
              <button class="btn-action delete-btn" data-id="${t.id}">🗑️</button>
            </div>
          </div>
        </div>
      </div>
    `).join("");

    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Mes sujets</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">

<style>
body { background:#f4f6fa; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto; }
.navbar-brand img { height:38px; border-radius:50%; margin-right:8px; }

/* Cartes uniformes */
.library-card-wrapper { margin-bottom:15px; }
.library-card { background:#fff; border-radius:18px; padding:14px; display:flex; flex-direction:column; box-shadow:0 8px 20px rgba(0,0,0,.06); height:250px; overflow:hidden; transition:all 0.3s ease;}
.card-header-custom { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
.avatar { width:42px; height:42px; border-radius:50%; object-fit:cover; }
.title { font-size:0.9rem; font-weight:600; }
.content-bubble { background:#e8f2ff; border-radius:14px; padding:12px; font-size:0.85rem; color:#333; flex:1 1 auto; overflow:hidden; display:-webkit-box; -webkit-line-clamp:5; -webkit-box-orient:vertical; }
.card-footer-custom { display:flex; flex-direction:column; gap:6px; margin-top:8px; }
.card-footer-custom small { font-size:0.7rem; color:#888; }
.actions { display:flex; justify-content:flex-end; gap:10px; margin-top:4px; }
.btn-action { border:none; background:#f1f3f7; border-radius:50%; width:34px; height:34px; font-size:0.85rem; cursor:pointer; }
.btn-action:hover { background:#e1e7f0; }

/* MODAL iOS */
.modal-ios { position:fixed; inset:0; background:rgba(0,0,0,.45); display:none; align-items:center; justify-content:center; z-index:2000; }
.modal-ios-content { background:white; border-radius:20px; width:90%; max-width:380px; padding:20px; animation:fadeUp .25s ease; }
@keyframes fadeUp { from { transform:translateY(20px); opacity:0 } to { transform:none; opacity:1 } }
.modal-ios-content h5 { font-size:1rem; margin-bottom:10px; }
.modal-ios-content button { width:100%; border-radius:14px; padding:10px; margin-top:8px; border:none; }
.btn-ios-danger { background:#ff4d4f; color:white; }
.btn-ios-primary { background:#0b57d0; color:white; }
.btn-ios-cancel { background:#f1f1f1; }

/* Recherche */
#searchInput { margin-bottom:15px; }
</style>
</head>
<body>

<!-- NAVBAR COMPLETE -->
<nav class="navbar navbar-expand-lg navbar-dark bg-primary shadow">
  <div class="container-fluid">
    <a class="navbar-brand fw-bold d-flex align-items-center" href="/forum">
      <img src="/img/log2.jpg"> ASSHA
    </a>
    <button class="navbar-toggler" data-bs-toggle="collapse" data-bs-target="#nav">
      <span class="navbar-toggler-icon"></span>
    </button>
    <div id="nav" class="collapse navbar-collapse">
      <ul class="navbar-nav me-auto">
        <li class="nav-item"><a class="nav-link" data-i18n="nav_video" href="/poster-video">Poster vidéo</a></li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_forum">Forum</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item" data-i18n="nav_post_topic" href="/forum/new-topic">Poster un sujet</a></li>
            <li><a class="dropdown-item" data-i18n="nav_view_topics" href="/forum/topics">Consulter les sujets</a></li>
            <li><a class="dropdown-item active" data-i18n="nav_my_topics" href="/forum/my-topics">Mes sujets</a></li>
          </ul>
        </li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_payment">Paiement</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item" href="/paiement/contribution">Contribution</a></li>
            <li><a class="dropdown-item" href="/paiement/donation">Faire un don</a></li>
            <li><a class="dropdown-item" href="/paiement/journal">Journal</a></li>
          </ul>
        </li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_publication">Publication</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item" href="/publication/social">Social</a></li>
          </ul>
        </li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_contact">Contact</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item" href="/contact/send-mail">Envoyer un email</a></li>
          </ul>
        </li>
        <li class="nav-item"><a class="nav-link" href="/bibliotheque">Bibliothèque</a></li>
      </ul>
    </div>
  </div>
</nav>

<div class="container mt-4">
  <h3 class="mb-3" data-i18n="my_topics_title">Mes sujets</h3>
  <input type="text" id="searchInput" class="form-control" placeholder="Rechercher un sujet...">
  <div class="row g-3" id="topicsContainer">
    ${cards || "<p data-i18n='no_topics'>Aucun sujet.</p>"}
  </div>
</div>

<!-- MODAL EDIT -->
<div class="modal-ios" id="editModal">
  <div class="modal-ios-content">
    <h5 data-i18n="edit_topic_title">Modifier le sujet</h5>
    <form id="editForm" method="POST">
      <input id="editTitle" name="title" class="form-control mb-2" required maxlength="150">
      <textarea id="editContent" name="content" class="form-control" rows="4" required></textarea>
      <button class="btn-ios-primary" data-i18n="update_btn">Enregistrer</button>
      <button type="button" class="btn-ios-cancel" onclick="closeEdit()" data-i18n="cancel_btn">Annuler</button>
    </form>
  </div>
</div>

<!-- MODAL DELETE -->
<div class="modal-ios" id="deleteModal">
  <div class="modal-ios-content">
    <h5 data-i18n="delete_confirmation">Supprimer ce sujet ?</h5>
    <button id="confirmDelete" class="btn-ios-danger" data-i18n="delete_btn">Supprimer</button>
    <button class="btn-ios-cancel" onclick="closeDelete()" data-i18n="cancel_btn">Annuler</button>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
<script>
// i18n localStorage
const i18n = {
  fr: {
    nav_video:"Poster vidéo", nav_forum:"Forum", nav_post_topic:"Poster un sujet",
    nav_view_topics:"Consulter les sujets", nav_my_topics:"Mes sujets", nav_payment:"Paiement",
    nav_publication:"Publication", nav_contact:"Contact",
    my_topics_title:"Mes sujets", no_topics:"Vous n'avez encore publié aucun sujet.",
    edit_topic_title:"Modifier le sujet", update_btn:"Mettre à jour",
    cancel_btn:"Annuler", delete_confirmation:"Voulez-vous vraiment supprimer ce sujet ?", delete_btn:"Supprimer"
  },
  en: {
    nav_video:"Post Video", nav_forum:"Forum", nav_post_topic:"Post Topic",
    nav_view_topics:"View Topics", nav_my_topics:"My Topics", nav_payment:"Payment",
    nav_publication:"Publication", nav_contact:"Contact",
    my_topics_title:"My Topics", no_topics:"You have not posted any topic yet.",
    edit_topic_title:"Edit Topic", update_btn:"Update",
    cancel_btn:"Cancel", delete_confirmation:"Are you sure you want to delete this topic?", delete_btn:"Delete"
  }
};

function applyLang() {
  const lang = localStorage.getItem("lang") || "fr";
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n;
    if(i18n[lang][key]) el.textContent = i18n[lang][key];
  });
}
applyLang();

// Recherche en direct
const searchInputEl = document.getElementById("searchInput");
searchInputEl.addEventListener("input", () => {
  const query = searchInputEl.value.toLowerCase();
  document.querySelectorAll(".library-card-wrapper").forEach(card => {
    const title = card.dataset.title;
    const content = card.dataset.content;
    card.style.display = (title.includes(query) || content.includes(query)) ? "block" : "none";
  });
});

// EDIT
let currentId = null;
document.querySelectorAll(".edit-btn").forEach(b => {
  b.onclick = () => {
    currentId = b.dataset.id;
    editTitle.value = b.dataset.title;
    editContent.value = b.dataset.content;
    editForm.action = "/forum/edit-topic/" + currentId;
    editModal.style.display = "flex";
  };
});
function closeEdit() { editModal.style.display = "none"; }

// DELETE
document.querySelectorAll(".delete-btn").forEach(b => {
  b.onclick = () => {
    currentId = b.dataset.id;
    deleteModal.style.display = "flex";
  };
});
confirmDelete.onclick = () => { location.href = "/forum/delete-topic/" + currentId; };
function closeDelete() { deleteModal.style.display = "none"; }
</script>
</body>
</html>`);
  });
});



app.post("/forum/edit-topic/:id", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  const topicId = req.params.id;
  const userId = req.session.user.id;
  const { title, content } = req.body;

  const sql = `UPDATE forum_topics SET title = ?, content = ? WHERE id = ? AND user_id = ?`;
  db.query(sql, [title, content, topicId, userId], (err) => {
    if (err) return res.send("Erreur lors de la mise à jour.");
    res.redirect("/forum/my-topics");
  });
});





// ==================== BACK-END ====================

app.get("/paiement/contribution", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Contribution</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
<style>
body { background:#f4f6fa; font-family:Segoe UI,Tahoma,Geneva,Verdana,sans-serif; }
.section { background:#fff; border-radius:18px; padding:30px; max-width:720px; margin:auto; }
.section h2 { color:#0b57d0; margin-bottom:10px; text-align:center; }
.contribution-image img { width: 100%; max-height: 300px; height: auto; object-fit: cover; border-radius: 12px; margin-bottom: 20px; }
.info-box { background:#e7f0ff; border-radius:12px; padding:16px; font-size:15px; margin-bottom:25px; text-align:center; }
.modal-ios .modal-content { border-radius:20px;text-align:center;padding:25px;background:#fff;box-shadow:0 5px 25px rgba(0,0,0,0.2);}
.modal-ios .btn-primary {border-radius:15px;width:70%;max-width:200px;}
</style>
</head>
<body>

<!-- NAVBAR -->
<nav class="navbar navbar-expand-lg navbar-dark bg-primary shadow">
<div class="container-fluid">
<a class="navbar-brand fw-bold d-flex align-items-center" href="/forum">
<img src="/img/log2.jpg" style="height:40px;border-radius:50%;margin-right:10px;">ASSHA
</a>
<button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarContent">
<span class="navbar-toggler-icon"></span>
</button>
<div class="collapse navbar-collapse" id="navbarContent">
<ul class="navbar-nav me-auto">
<li class="nav-item"><a class="nav-link" href="/poster-video" data-i18n="nav_video">Poster vidéo</a></li>
<li class="nav-item dropdown"><a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_forum">Forum</a>
<ul class="dropdown-menu">
<li><a class="dropdown-item" href="/forum/new-topic" data-i18n="nav_post_topic">Poster un sujet</a></li>
<li><a class="dropdown-item" href="/forum/topics" data-i18n="nav_view_topics">Consulter les sujets</a></li>
<li><a class="dropdown-item" href="/forum/my-topics" data-i18n="nav_my_topics">Mes sujets</a></li>
</ul></li>
<li class="nav-item dropdown"><a class="nav-link dropdown-toggle active" href="#" data-bs-toggle="dropdown" data-i18n="nav_payment">Paiement</a>
<ul class="dropdown-menu">
<li><a class="dropdown-item active" href="/paiement/contribution" data-i18n="nav_contribution">Contribution</a></li>
<li><a class="dropdown-item" href="/paiement/donation" data-i18n="nav_donation">Faire un don</a></li>
<li><a class="dropdown-item" href="/paiement/journal" data-i18n="nav_journal">Journal</a></li>
</ul></li>
<li class="nav-item dropdown"><a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_publication">Publication</a>
<ul class="dropdown-menu"><li><a class="dropdown-item" href="/publication/social">Social</a></li></ul></li>
<li class="nav-item dropdown"><a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_contact">Contact</a>
<ul class="dropdown-menu"><li><a class="dropdown-item" href="/contact/send-mail">Envoyer un email</a></li></ul></li>
<li class="nav-item"><a class="nav-link" href="/bibliotheque" data-i18n="nav_library">Bibliothèque</a></li>
</ul>
</div></div></nav>

<div class="container mt-4">
<div class="section">
<h2 data-i18n="contribution_title">Contribution d’adhésion</h2>
<div class="contribution-image text-center mb-3">
  <img src="/img/sd.avif" alt="Contribution" class="img-fluid rounded">
</div>
<div class="info-box" data-i18n="contribution_info">Merci de votre soutien ! Vous recevrez une notification de votre paiement dans le journal de dépôt.</div>

<form id="contributionForm">
<div class="mb-4">
<label class="form-label fw-semibold" data-i18n="amount_label">Montant de la contribution</label>
<select class="form-select" name="montant" required>
<option value="" data-i18n="amount_placeholder">-- Choisir un montant --</option>
<option value="10">10 USD</option>
<option value="20">20 USD</option>
<option value="50">50 USD</option>
<option value="100">100 USD</option>
<option value="200">200 USD</option>
<option value="300">300 USD</option>
<option value="500">500 USD</option>
</select>
</div>

<div class="mb-4">
<label class="form-label fw-semibold" data-i18n="operator_label">Choisir un opérateur</label>
<select class="form-select" name="operateur" required>
<option value="" data-i18n="operator_placeholder">-- Choisir un opérateur --</option>
<option value="Airtel">Airtel Money</option>
<option value="Vodacom">M-Pesa</option>
<option value="Orange">Orange Money</option>
</select>
</div>

<button type="button" id="openContributionModal" class="btn btn-primary w-100 py-2" data-i18n="proceed_btn">Procéder au dépôt</button>
</form>
</div></div>

<!-- Modal mot de passe -->
<div class="modal fade modal-ios" id="contributionModal" tabindex="-1">
<div class="modal-dialog modal-dialog-centered">
<div class="modal-content">
<div class="modal-header border-0">
<h5 class="modal-title fw-bold" data-i18n="modal_title">Confirmation de la contribution</h5>
<button type="button" class="btn-close" data-bs-dismiss="modal"></button>
</div>
<div class="modal-body">
<div id="contributionPasswordStep">
<p class="text-muted text-center" data-i18n="modal_password_text">Veuillez saisir votre mot de passe pour obtenir le numéro de dépôt.</p>
<input type="password" id="contributionPassword" class="form-control mb-3" placeholder="Mot de passe">
<button class="btn btn-primary w-100" id="verifyContributionPassword" data-i18n="modal_continue_btn">Continuer</button>
</div>
<div id="contributionNumbersStep" class="d-none">
<div class="alert alert-success text-center rounded-3" data-i18n="modal_thanks">Merci pour votre contribution !</div>
<ul class="list-group text-center fw-semibold" id="contributionNumbersList"></ul>
<p class="text-center mt-3 text-muted" data-i18n="modal_info">Votre contribution sera enregistrée dans le journal après confirmation.</p>
</div>
</div>
</div>
</div>
</div>

<!-- Modal erreur mot de passe -->
<div class="modal fade modal-ios" id="errorModal" tabindex="-1">
<div class="modal-dialog modal-dialog-centered">
<div class="modal-content">
<div class="modal-body text-center">
<p id="errorText" style="font-weight:600;color:#ff3b30;"></p>
</div>
<div class="modal-footer justify-content-center border-0">
<button type="button" class="btn btn-primary w-50" data-bs-dismiss="modal">OK</button>
</div>
</div>
</div>
</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
<script>
// i18n FR/EN
const i18n = {
  fr: {
    nav_video:"Poster vidéo",
    nav_forum:"Forum",
    nav_post_topic:"Poster un sujet",
    nav_view_topics:"Consulter les sujets",
    nav_my_topics:"Mes sujets",
    nav_payment:"Paiement",
    nav_contribution:"Contribution",
    nav_donation:"Faire un don",
    nav_journal:"Journal",
    nav_publication:"Publication",
    nav_contact:"Contact",
    nav_library:"Bibliothèque",
    contribution_title:"Contribution d’adhésion",
    contribution_info:"Merci de votre soutien ! Vous recevrez une notification de votre paiement dans le journal de dépôt.",
    amount_label:"Montant de la contribution",
    amount_placeholder:"-- Choisir un montant --",
    operator_label:"Choisir un opérateur",
    operator_placeholder:"-- Choisir un opérateur --",
    proceed_btn:"Procéder au dépôt",
    modal_title:"Confirmation de la contribution",
    modal_password_text:"Veuillez saisir votre mot de passe pour obtenir le numéro de dépôt.",
    modal_continue_btn:"Continuer",
    modal_thanks:"Merci pour votre contribution !",
    modal_info:"Votre contribution sera enregistrée dans le journal après confirmation."
  },
  en: {
    nav_video:"Post video",
    nav_forum:"Forum",
    nav_post_topic:"New topic",
    nav_view_topics:"View topics",
    nav_my_topics:"My topics",
    nav_payment:"Payment",
    nav_contribution:"Contribution",
    nav_donation:"Donate",
    nav_journal:"Journal",
    nav_publication:"Publication",
    nav_contact:"Contact",
    nav_library:"Library",
    contribution_title:"Membership Contribution",
    contribution_info:"Thank you for your support! You will receive a notification of your payment in the deposit journal.",
    amount_label:"Contribution amount",
    amount_placeholder:"-- Choose an amount --",
    operator_label:"Select operator",
    operator_placeholder:"-- Choose an operator --",
    proceed_btn:"Proceed to deposit",
    modal_title:"Contribution Confirmation",
    modal_password_text:"Please enter your password to get the deposit number.",
    modal_continue_btn:"Continue",
    modal_thanks:"Thank you for your contribution!",
    modal_info:"Your contribution will be recorded in the journal after confirmation."
  }
};
function applyLang(){
  const lang = localStorage.getItem("lang")||"fr";
  document.querySelectorAll("[data-i18n]").forEach(el=>{
    const key = el.dataset.i18n;
    if(i18n[lang][key]) el.textContent = i18n[lang][key];
  });
}
applyLang();

// Modals
const contributionModal = new bootstrap.Modal(document.getElementById("contributionModal"));
const errorModal = new bootstrap.Modal(document.getElementById("errorModal"));
const errorText = document.getElementById("errorText");
const numbersList = document.getElementById("contributionNumbersList");

document.getElementById("openContributionModal").addEventListener("click", ()=>contributionModal.show());

document.getElementById("verifyContributionPassword").addEventListener("click", ()=>{
  const pwd = document.getElementById("contributionPassword").value;
  const form = document.getElementById("contributionForm");
  const montant = form.querySelector('select[name="montant"]').value;
  const operateur = form.querySelector('select[name="operateur"]').value;

  if(!montant){ errorText.textContent="Veuillez choisir un montant"; errorModal.show(); return; }
  if(!operateur){ errorText.textContent="Veuillez choisir un opérateur"; errorModal.show(); return; }
  if(!pwd){ errorText.textContent="Veuillez saisir le mot de passe"; errorModal.show(); return; }

  // Vérifier mot de passe
  fetch('/verif-password-contribution',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ mot_de_passe: pwd })
  })
  .then(res=>res.json())
  .then(data=>{
    if(!data.success){
      errorText.textContent = data.message || "Mot de passe incorrect";
      errorModal.show();
      return;
    }

    // Enregistrer contribution
    fetch('/contribution',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ montant, operateur })
    })
    .then(res=>res.json())
    .then(result=>{
      if(result.success){
        document.getElementById("contributionPasswordStep").classList.add("d-none");
        document.getElementById("contributionNumbersStep").classList.remove("d-none");
        const numeros = {Airtel:'+243999111222', Vodacom:'+243888333444', Orange:'+243777555666'};
        numbersList.innerHTML = '<li class="list-group-item">'+operateur+'<br><span class="text-success fs-5">'+numeros[operateur]+'</span></li>';
        document.getElementById("contributionPassword").value="";
      } else {
        errorText.textContent = result.message || "Erreur enregistrement contribution";
        errorModal.show();
      }
    })
    .catch(err=>{
      errorText.textContent="Erreur serveur contribution";
      errorModal.show();
      console.error(err);
    });
  })
  .catch(err=>{
    errorText.textContent="Erreur serveur mot de passe";
    errorModal.show();
    console.error(err);
  });
});
</script>

</body>
</html>
`);
});


// Vérifie le mot de passe avant d'afficher le numéro de contribution
app.post('/verif-password-contribution', (req, res) => {
  if (!req.session.user) return res.status(401).json({ success:false, message:"Non connecté" });

  const { mot_de_passe } = req.body;
  if(!mot_de_passe) return res.status(400).json({ success:false, message:"Mot de passe manquant" });

  const sql = 'SELECT mot_de_passe FROM users WHERE id=?';
  db.query(sql, [req.session.user.id], (err, results)=>{
    if(err || results.length===0) return res.status(500).json({ success:false, message:"Erreur serveur" });

    const vraiMotDePasse = results[0].mot_de_passe;
    if(mot_de_passe === vraiMotDePasse){
      res.json({ success:true });
    } else {
      res.json({ success:false, message:"Mot de passe incorrect" });
    }
  });
});


// ==================== BACK-END POST ====================
app.post("/contribution", (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false, message: "Non connecté" });

  const { montant, operateur } = req.body;
  if(!montant || !operateur) return res.status(400).json({ success: false, message: "Données manquantes" });

  const numeros = {Airtel:'+243999111222', Vodacom:'+243888333444', Orange:'+243777555666'};
  const numero = numeros[operateur];
  if(!numero) return res.status(400).json({ success: false, message: "Opérateur invalide" });

  const sql = `INSERT INTO contributions (id_users, montant, statut, operateur, numero) VALUES (?, ?, ?, ?, ?)`;
  db.query(sql, [req.session.user.id, montant, "en_attente", operateur, numero], (err, result) => {
    if(err){
      console.error("ERREUR INSERT contribution:", err);
      return res.status(500).json({ success: false, message: "Erreur serveur" });
    }
    res.json({ success:true, contribution_id: result.insertId });
  });
});







// ==================== BACK-END ====================
app.get("/paiement/donation", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Faire un don</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
<style>
body { background:#f4f6fa; font-family:Segoe UI,Tahoma,Geneva,Verdana,sans-serif; }
.section { background:#fff; border-radius:18px; padding:30px; max-width:720px; margin:auto; }
.section h2 { color:#198754; margin-bottom:10px; text-align:center; }
.donation-image img { width: 100%; max-height: 300px; height: auto; object-fit: cover; border-radius: 12px; margin-bottom: 20px; }
.info-box { background:#e9f7ef; border-radius:12px; padding:16px; font-size:15px; margin-bottom:25px; text-align:center; }
.modal-ios .modal-content { border-radius:20px;text-align:center;padding:25px;background:#fff;box-shadow:0 5px 25px rgba(0,0,0,0.2);}
.modal-ios .modal-footer { justify-content:center; border-top:none; }
.modal-ios .btn-primary, .modal-ios .btn-success { border-radius:15px;width:80%;max-width:200px; }
</style>
</head>
<body>

<!-- NAVBAR -->
<nav class="navbar navbar-expand-lg navbar-dark bg-primary shadow">
<div class="container-fluid">
<a class="navbar-brand fw-bold d-flex align-items-center" href="/forum">
<img src="/img/log2.jpg" style="height:40px;border-radius:50%;margin-right:10px;">ASSHA
</a>
<button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarContent">
<span class="navbar-toggler-icon"></span>
</button>
<div class="collapse navbar-collapse" id="navbarContent">
<ul class="navbar-nav me-auto">
<li class="nav-item"><a class="nav-link" href="/poster-video" data-i18n="nav_video">Poster vidéo</a></li>
<li class="nav-item dropdown"><a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_forum">Forum</a>
<ul class="dropdown-menu">
<li><a class="dropdown-item" href="/forum/new-topic" data-i18n="nav_post_topic">Poster un sujet</a></li>
<li><a class="dropdown-item" href="/forum/topics" data-i18n="nav_view_topics">Consulter les sujets</a></li>
<li><a class="dropdown-item" href="/forum/my-topics" data-i18n="nav_my_topics">Mes sujets</a></li>
</ul></li>
<li class="nav-item dropdown"><a class="nav-link dropdown-toggle active" href="#" data-bs-toggle="dropdown" data-i18n="nav_payment">Paiement</a>
<ul class="dropdown-menu">
<li><a class="dropdown-item" href="/paiement/contribution" data-i18n="nav_contribution">Contribution</a></li>
<li><a class="dropdown-item active" href="/paiement/donation" data-i18n="nav_donation">Faire un don</a></li>
<li><a class="dropdown-item" href="/paiement/journal" data-i18n="nav_journal">Journal</a></li>
</ul></li>
<li class="nav-item dropdown"><a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_publication">Publication</a>
<ul class="dropdown-menu"><li><a class="dropdown-item" href="/publication/social">Social</a></li></ul></li>
<li class="nav-item dropdown"><a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_contact">Contact</a>
<ul class="dropdown-menu"><li><a class="dropdown-item" href="/contact/send-mail">Envoyer un email</a></li></ul></li>
<li class="nav-item"><a class="nav-link" href="/bibliotheque" data-i18n="nav_library">Bibliothèque</a></li>
</ul>
</div></div></nav>

<div class="container mt-4">
<div class="section">
<h2 data-i18n="donation_title">Don volontaire</h2>
<div class="donation-image text-center mb-3">
  <img src="/img/ds.avif" alt="Don volontaire" class="img-fluid rounded">
</div>
<div class="info-box" data-i18n="donation_info">
Ce don est un soutien financier libre offert à ASSHA pour accompagner ses actions.
</div>

<form id="donationForm">
<div class="mb-4">
<label class="form-label fw-semibold" data-i18n="amount_label">Montant du don</label>
<select class="form-select" name="montant" required>
<option value="" data-i18n="amount_placeholder">-- Choisir un montant --</option>
<option value="10">10 USD</option>
<option value="20">20 USD</option>
<option value="50">50 USD</option>
<option value="100">100 USD</option>
<option value="200">200 USD</option>
<option value="300">300 USD</option>
<option value="500">500 USD</option>
</select>
</div>

<div class="mb-4">
<label class="form-label fw-semibold" data-i18n="operator_label">Choisir un opérateur</label>
<select class="form-select" name="operateur" required>
<option value="" data-i18n="operator_placeholder">-- Choisir un opérateur --</option>
<option value="Airtel">Airtel Money</option>
<option value="Vodacom">M-Pesa</option>
<option value="Orange">Orange Money</option>
</select>
</div>

<button type="button" id="openDonationModal" class="btn btn-success w-100 py-2" data-i18n="proceed_btn">Offrir ce don</button>
</form>
</div></div>

<!-- Modal erreur -->
<div class="modal fade modal-ios" id="donationErrorModal" tabindex="-1">
<div class="modal-dialog modal-dialog-centered">
<div class="modal-content">
<div class="modal-body text-center">
<p id="donationErrorText" class="fw-bold text-danger"></p>
</div>
<div class="modal-footer">
<button type="button" class="btn btn-primary" data-bs-dismiss="modal" data-i18n="ok_btn">OK</button>
</div>
</div></div></div>

<!-- Modal principale -->
<div class="modal fade modal-ios" id="donationModal" tabindex="-1">
<div class="modal-dialog modal-dialog-centered">
<div class="modal-content">
<div class="modal-header border-0">
<h5 class="modal-title fw-bold" data-i18n="modal_title">Confirmation du don</h5>
<button type="button" class="btn-close" data-bs-dismiss="modal"></button>
</div>
<div class="modal-body">
<div id="donationPasswordStep">
<p class="text-muted text-center" data-i18n="modal_password_text">Veuillez saisir votre mot de passe pour confirmer le don.</p>
<input type="password" id="donationPassword" class="form-control mb-3" placeholder="Mot de passe">
<button class="btn btn-success w-100" id="verifyDonationPassword" data-i18n="modal_continue_btn">Continuer</button>
</div>
<div id="donationNumbersStep" class="d-none">
<div class="alert alert-success text-center rounded-3" data-i18n="modal_thanks">Merci pour votre soutien à ASSHA</div>
<ul class="list-group text-center fw-semibold" id="donationNumbersList"></ul>
<p class="text-center mt-3 text-muted" data-i18n="modal_info">Votre don sera enregistré dans le journal après confirmation.</p>
</div>
</div>
</div></div></div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
<script>
const i18n = {
  fr: {
    nav_video:"Poster vidéo",
    nav_forum:"Forum",
    nav_post_topic:"Poster un sujet",
    nav_view_topics:"Consulter les sujets",
    nav_my_topics:"Mes sujets",
    nav_payment:"Paiement",
    nav_contribution:"Contribution",
    nav_donation:"Faire un don",
    nav_journal:"Journal",
    nav_publication:"Publication",
    nav_contact:"Contact",
    nav_library:"Bibliothèque",
    donation_title:"Don volontaire",
    donation_info:"Ce don est un soutien financier libre offert à ASSHA pour accompagner ses actions.",
    amount_label:"Montant du don",
    amount_placeholder:"-- Choisir un montant --",
    operator_label:"Choisir un opérateur",
    proceed_btn:"Offrir ce don",
    modal_title:"Confirmation du don",
    modal_password_text:"Veuillez saisir votre mot de passe pour confirmer le don.",
    modal_continue_btn:"Continuer",
    modal_thanks:"Merci pour votre soutien à ASSHA",
    modal_info:"Votre don sera enregistré dans le journal après confirmation.",
    ok_btn:"OK"
  },
  en: {
    nav_video:"Post video",
    nav_forum:"Forum",
    nav_post_topic:"New topic",
    nav_view_topics:"View topics",
    nav_my_topics:"My topics",
    nav_payment:"Payment",
    nav_contribution:"Contribution",
    nav_donation:"Donate",
    nav_journal:"Journal",
    nav_publication:"Publication",
    nav_contact:"Contact",
    nav_library:"Library",
    donation_title:"Voluntary Donation",
    donation_info:"This donation is a free financial support offered to ASSHA to accompany its actions.",
    amount_label:"Donation amount",
    amount_placeholder:"-- Choose an amount --",
    operator_label:"Select operator",
    proceed_btn:"Offer this donation",
    modal_title:"Donation Confirmation",
    modal_password_text:"Please enter your password to confirm the donation.",
    modal_continue_btn:"Continue",
    modal_thanks:"Thank you for supporting ASSHA",
    modal_info:"Your donation will be recorded in the journal after confirmation.",
    ok_btn:"OK"
  }
};

function applyLang(){
  const lang = localStorage.getItem("lang")||"fr";
  document.querySelectorAll("[data-i18n]").forEach(el=>{
    const key = el.dataset.i18n;
    if(i18n[lang][key]) el.textContent = i18n[lang][key];
  });
}
applyLang();

// Modals
const donationModal = new bootstrap.Modal(document.getElementById("donationModal"));
const errorModal = new bootstrap.Modal(document.getElementById("donationErrorModal"));
const errorText = document.getElementById("donationErrorText");
const numbersList = document.getElementById("donationNumbersList");

document.getElementById("openDonationModal").addEventListener("click", ()=>donationModal.show());

document.getElementById("verifyDonationPassword").addEventListener("click", ()=>{
  const pwd = document.getElementById("donationPassword").value;
  const form = document.getElementById("donationForm");
  const montant = form.querySelector('select[name="montant"]').value;
  const operateur = form.querySelector('select[name="operateur"]').value;

  if(!montant){ errorText.textContent=i18n[localStorage.getItem("lang")||"fr"].amount_placeholder; errorModal.show(); return; }
  if(!operateur){ errorText.textContent=i18n[localStorage.getItem("lang")||"fr"].operator_placeholder; errorModal.show(); return; }
  if(!pwd){ errorText.textContent="Veuillez saisir le mot de passe"; errorModal.show(); return; }

  fetch('/api/paiement/donation', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ montant, operateur, mot_de_passe: pwd })
  })
  .then(res=>res.json())
  .then(data=>{
    if(!data.success){ 
      errorText.textContent=data.message||"Mot de passe incorrect"; 
      errorModal.show();
      return;
    }
    document.getElementById("donationPasswordStep").classList.add("d-none");
    document.getElementById("donationNumbersStep").classList.remove("d-none");
    numbersList.innerHTML="";
    const numeros={ Airtel:'+243999111222', Vodacom:'+243888333444', Orange:'+243777555666' };
    const li=document.createElement("li");
    li.classList.add("list-group-item");
    li.textContent=operateur+" ";
    const span=document.createElement("span");
    span.classList.add("text-success","fs-5");
    span.textContent=numeros[operateur];
    li.appendChild(span);
    numbersList.appendChild(li);
    document.getElementById("donationPassword").value="";
  })
  .catch(err=>{
    errorText.textContent="Erreur serveur"; 
    errorModal.show();
    console.error(err);
  });
});
</script>
</body>
</html>`);
});



// ==================== BACK-END POST ====================
app.post("/api/paiement/donation", (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false, message: "Non connecté" });

  const { montant, operateur, mot_de_passe } = req.body;
  if (!montant || !operateur || !mot_de_passe) return res.status(400).json({ success: false, message: "Données manquantes" });

  db.query("SELECT mot_de_passe FROM users WHERE id = ?", [req.session.user.id], (err, results) => {
    if (err) return res.status(500).json({ success: false, message: "Erreur serveur" });
    if (results.length === 0) return res.status(404).json({ success: false, message: "Utilisateur introuvable" });

    if (results[0].mot_de_passe !== mot_de_passe) return res.status(403).json({ success: false, message: "Mot de passe incorrect" });

    const numeros = { Airtel: '+243999111222', Vodacom: '+243888333444', Orange: '+243777555666' };
    const numero = numeros[operateur];
    if (!numero) return res.status(400).json({ success: false, message: "Opérateur invalide" });

    const sql = `INSERT INTO donations (id_users, montant, statut, operateur, numero) VALUES (?,?,?,?,?)`;
    db.query(sql, [req.session.user.id, montant, "en_attente", operateur, numero], (err, result) => {
      if (err) {
        console.error("ERREUR INSERT donations:", err);
        return res.status(500).json({ success: false, message: "Erreur serveur" });
      }
      res.json({ success: true, donation_id: result.insertId });
    });
  });
});






// GET journal des paiements
app.get("/paiement/journal", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const userId = req.session.user.id;

  const sql = `
    SELECT 'contribution' AS type, montant, operateur, numero AS numero_depot, statut, created_at
    FROM contributions
    WHERE id_users = ?
    UNION ALL
    SELECT 'donation' AS type, montant, operateur, numero AS numero_depot, statut, date_creation AS created_at
    FROM donations
    WHERE id_users = ?
    ORDER BY created_at DESC
  `;

  db.query(sql, [userId, userId], (err, results) => {
    if (err) {
      console.error(err);
      return res.send("Erreur lors de la récupération du journal.");
    }

    let rows = results.map(r => `
      <tr>
        <td data-type="${r.type}">${r.type}</td>
        <td>${r.montant} USD</td>
        <td>${r.operateur || '-'}</td>
        <td>${r.numero_depot || '-'}</td>
        <td>${r.statut}</td>
        <td>${new Date(r.created_at).toLocaleString()}</td>
      </tr>
    `).join("");

    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Journal des paiements</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
<style>
body { background: #f4f6fa; font-family: Segoe UI, Tahoma, Geneva, Verdana, sans-serif; }
.section { background: #fff; border-radius: 15px; padding: 20px; box-shadow: 0 5px 15px rgba(0,0,0,0.1); margin: auto; max-width: 1000px; }
.section h2 { color: #0b57d0; margin-bottom: 20px; }
.table-custom th, .table-custom td { vertical-align: middle; }
.table-responsive { overflow-x: auto; }
@media (max-width: 576px) { .section { padding: 15px; border-radius: 12px; } .table-custom th, .table-custom td { font-size: 14px; padding: 0.4rem; } }
@media (min-width: 577px) and (max-width: 992px) { .section { padding: 18px; } .table-custom th, .table-custom td { font-size: 15px; } }
@media (min-width: 993px) { .section { padding: 25px; } }
</style>
</head>
<body>

<nav class="navbar navbar-expand-lg navbar-dark bg-primary shadow">
<div class="container-fluid">
<a class="navbar-brand fw-bold d-flex align-items-center" href="/forum">
<img src="/img/log2.jpg" style="height:40px;border-radius:50%;margin-right:10px;">ASSHA
</a>
<button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarContent">
<span class="navbar-toggler-icon"></span>
</button>
<div class="collapse navbar-collapse" id="navbarContent">
<ul class="navbar-nav me-auto">
<li class="nav-item"><a class="nav-link" href="/poster-video" data-i18n="nav_video">Poster vidéo</a></li>
<li class="nav-item dropdown"><a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_forum">Forum</a>
<ul class="dropdown-menu">
<li><a class="dropdown-item" href="/forum/new-topic" data-i18n="nav_post_topic">Poster un sujet</a></li>
<li><a class="dropdown-item" href="/forum/topics" data-i18n="nav_view_topics">Consulter les sujets</a></li>
<li><a class="dropdown-item" href="/forum/my-topics" data-i18n="nav_my_topics">Mes sujets</a></li>
</ul></li>
<li class="nav-item dropdown"><a class="nav-link dropdown-toggle active" href="#" data-bs-toggle="dropdown" data-i18n="nav_payment">Paiement</a>
<ul class="dropdown-menu">
<li><a class="dropdown-item" href="/paiement/contribution" data-i18n="nav_contribution">Contribution</a></li>
<li><a class="dropdown-item" href="/paiement/donation" data-i18n="nav_donation">Faire un don</a></li>
<li><a class="dropdown-item active" href="/paiement/journal" data-i18n="nav_journal">Journal</a></li>
</ul></li>
<li class="nav-item dropdown"><a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_publication">Publication</a>
<ul class="dropdown-menu"><li><a class="dropdown-item" href="/publication/social">Social</a></li></ul></li>
<li class="nav-item dropdown"><a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_contact">Contact</a>
<ul class="dropdown-menu"><li><a class="dropdown-item" href="/contact/send-mail">Envoyer un email</a></li></ul></li>
<li class="nav-item"><a class="nav-link" href="/bibliotheque" data-i18n="nav_library">Bibliothèque</a></li>
</ul>
</div></div></nav>

<div class="container mt-4">
<div class="section">
<h2 data-i18n="journal_title">Journal des paiements en attente</h2>

${results.length === 0 ? 
  '<div class="alert alert-info text-center" data-i18n="journal_empty">Aucun paiement en attente.</div>' :
  `<div class="table-responsive">
    <table class="table table-striped table-hover table-custom">
      <thead class="table-primary">
        <tr>
          <th data-i18n="type">Type</th>
          <th data-i18n="amount">Montant</th>
          <th data-i18n="operator">Opérateur</th>
          <th data-i18n="numero">Numéro dépôt</th>
          <th data-i18n="status">Statut</th>
          <th data-i18n="date">Date</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>`}
</div>
</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
<script>
// Traduction FR/EN
const i18n = {
  fr: {
    nav_video:"Poster vidéo", nav_forum:"Forum", nav_post_topic:"Poster un sujet",
    nav_view_topics:"Consulter les sujets", nav_my_topics:"Mes sujets", nav_payment:"Paiement",
    nav_contribution:"Contribution", nav_donation:"Faire un don", nav_journal:"Journal",
    nav_publication:"Publication", nav_contact:"Contact", nav_library:"Bibliothèque",
    journal_title:"Journal des paiements en attente", journal_empty:"Aucun paiement en attente.",
    type:"Type", amount:"Montant", operator:"Opérateur", numero:"Numéro dépôt", status:"Statut", date:"Date"
  },
  en: {
    nav_video:"Post Video", nav_forum:"Forum", nav_post_topic:"Post Topic",
    nav_view_topics:"View Topics", nav_my_topics:"My Topics", nav_payment:"Payment",
    nav_contribution:"Contribution", nav_donation:"Donation", nav_journal:"Journal",
    nav_publication:"Publication", nav_contact:"Contact", nav_library:"Library",
    journal_title:"Pending Payments Journal", journal_empty:"No pending payments.",
    type:"Type", amount:"Amount", operator:"Operator", numero:"Deposit Number", status:"Status", date:"Date"
  }
};

function applyLang() {
  const lang = localStorage.getItem("lang") || "fr";
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n;
    if(i18n[lang][key]) el.textContent = i18n[lang][key];
  });
}
applyLang();
</script>

</body>
</html>`);
  });
});
























app.get("/publication/social", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Bibliothèque des Publications</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
<style>
body{background:#f4f6fa;font-family:Segoe UI,Tahoma,Geneva,Verdana,sans-serif;margin:0;padding:0;}
.library-container{max-width:1000px;margin:20px auto;padding:0 10px;}
.search-bar{margin-bottom:15px;display:flex;gap:10px;}
.search-bar input{flex:1;padding:10px 15px;border-radius:15px;border:1px solid #ccc;font-size:0.95rem;background:#e6f0ff;}
.search-bar button{padding:10px 15px;border-radius:15px;border:none;background:#0d6efd;color:#fff;cursor:pointer;}
.library-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px;}
.card-post{background:#fff;border-radius:15px;padding:15px;box-shadow:0 6px 20px rgba(0,0,0,.1);display:flex;flex-direction:column;}
.card-post img.avatar{width:50px;height:50px;border-radius:50%;object-fit:cover;margin-right:10px;}
.card-header{display:flex;align-items:center;margin-bottom:10px;}
.card-header strong{font-size:1.1rem;}
.card-content{flex:1;}
.card-content p{margin:5px 0;}
.card-content img.post-image{width:100%;border-radius:12px;margin-top:10px;}
.card-actions{display:flex;gap:10px;margin-top:10px;align-items:center;}
.card-actions button,.card-actions a{display:flex;align-items:center;gap:5px;}
.small-text{font-size:0.75rem;color:#555;margin-top:5px;}
.modal-ios { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #fff; border-radius: 15px; width: 90%; max-width: 320px; padding: 20px; box-shadow: 0 5px 15px rgba(0,0,0,0.3); display: none; z-index: 1000; text-align: center; }
.modal-ios h4 { margin-bottom: 15px; font-size: 1rem; }
.modal-ios .btns { display: flex; justify-content: space-around; margin-top: 10px; }
.modal-ios .btn { padding: 6px 12px; border-radius: 10px; border: none; cursor: pointer; font-weight: 500; }
.modal-ios .btn.cancel { background: #ccc; color: #000; }
.modal-ios .btn.confirm { background: #0d6efd; color: #fff; }
.modal-backdrop { position: fixed; top:0; left:0; right:0; bottom:0; background: rgba(0,0,0,0.4); z-index: 999; display: none; }
@media (max-width:576px){
  .card-post img.post-image{max-height:250px;object-fit:cover;}
  .card-post img.avatar{width:40px;height:40px;}
}
@media (min-width:577px) and (max-width:992px){
  .card-post img.post-image{max-height:350px;}
}
</style>
</head>
<body>

<!-- NAVBAR -->
<nav class="navbar navbar-expand-lg navbar-dark bg-primary shadow">
<div class="container-fluid">
<a class="navbar-brand fw-bold d-flex align-items-center" href="/forum">
<img src="/img/log2.jpg" style="height:40px;border-radius:50%;margin-right:10px;">ASSHA
</a>
<button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarContent">
<span class="navbar-toggler-icon"></span>
</button>
<div class="collapse navbar-collapse" id="navbarContent">
<ul class="navbar-nav me-auto">
<li class="nav-item"><a class="nav-link" href="/poster-video" data-i18n="nav_video">Poster vidéo</a></li>
<li class="nav-item dropdown"><a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_forum">Forum</a>
<ul class="dropdown-menu">
<li><a class="dropdown-item" href="/forum/new-topic" data-i18n="nav_post_topic">Poster un sujet</a></li>
<li><a class="dropdown-item" href="/forum/topics" data-i18n="nav_view_topics">Consulter les sujets</a></li>
<li><a class="dropdown-item" href="/forum/my-topics" data-i18n="nav_my_topics">Mes sujets</a></li>
</ul></li>
<li class="nav-item dropdown"><a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_payment">Paiement</a>
<ul class="dropdown-menu">
<li><a class="dropdown-item" href="/paiement/contribution" data-i18n="nav_contribution">Contribution</a></li>
<li><a class="dropdown-item" href="/paiement/donation" data-i18n="nav_donation">Faire un don</a></li>
<li><a class="dropdown-item" href="/paiement/journal" data-i18n="nav_journal">Journal</a></li>
</ul></li>
<li class="nav-item dropdown"><a class="nav-link dropdown-toggle active" href="#" data-bs-toggle="dropdown" data-i18n="nav_publication">Publication</a>
<ul class="dropdown-menu"><li><a class="dropdown-item active" href="/publication/social" data-i18n="nav_social">Social</a></li></ul></li>
<li class="nav-item dropdown"><a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_contact">Contact</a>
<ul class="dropdown-menu"><li><a class="dropdown-item" href="/contact/send-mail" data-i18n="nav_send_email">Envoyer un email</a></li></ul></li>
<li class="nav-item"><a class="nav-link" href="/bibliotheque" data-i18n="nav_library">Bibliothèque</a></li>
</ul>
</div></div></nav>

<div class="library-container">
  <div class="search-bar">
    <input type="text" id="searchInput" placeholder="Rechercher des publications...">
    <button onclick="applySearch()">🔍</button>
  </div>
  <div id="posts" class="library-grid"></div>
</div>

<!-- Modal iOS -->
<div class="modal-backdrop" id="modalBackdrop"></div>
<div class="modal-ios" id="modalIOS">
  <h4 id="modalTitle">Info</h4>
  <p id="modalMessage"></p>
  <div class="btns">
    <button class="btn cancel" onclick="closeModal()">Fermer</button>
  </div>
</div>

<script>
const i18n = {
  fr:{nav_video:"Poster vidéo",nav_forum:"Forum",nav_post_topic:"Poster un sujet",nav_view_topics:"Consulter les sujets",nav_my_topics:"Mes sujets",nav_payment:"Paiement",nav_contribution:"Contribution",nav_donation:"Faire un don",nav_journal:"Journal",nav_publication:"Publication",nav_social:"Social",nav_contact:"Contact",nav_send_email:"Envoyer un email",nav_library:"Bibliothèque",library_posts:"Bibliothèque des publications",no_posts:"Aucune publication",already_liked:"Vous avez déjà liké ce post",search_placeholder:"Rechercher des publications..."},
  en:{nav_video:"Post Video",nav_forum:"Forum",nav_post_topic:"Post Topic",nav_view_topics:"View Topics",nav_my_topics:"My Topics",nav_payment:"Payment",nav_contribution:"Contribution",nav_donation:"Make a donation",nav_journal:"Journal",nav_publication:"Publication",nav_social:"Social",nav_contact:"Contact",nav_send_email:"Send Email",nav_library:"Library",library_posts:"Library Posts",no_posts:"No posts",already_liked:"You already liked this post",search_placeholder:"Search posts..."}
};

const lang = localStorage.getItem("lang")||"fr";
document.querySelectorAll("[data-i18n]").forEach(el=>{const key=el.dataset.i18n;if(i18n[lang][key])el.textContent=i18n[lang][key];});
document.getElementById("searchInput").placeholder = i18n[lang].search_placeholder;

let allPosts = [];

async function fetchPosts(){
  const res = await fetch('/api/posts');
  allPosts = await res.json();
  renderPosts(allPosts);
}

function renderPosts(posts){
  const box = document.getElementById('posts');
  box.innerHTML = '';
  if(!posts.length){
    box.innerHTML = '<div class="alert alert-info">'+i18n[lang].no_posts+'</div>';
    return;
  }
  posts.sort((a,b)=>new Date(b.date_creation)-new Date(a.date_creation));
  posts.forEach(p=>{
    const likedPosts = JSON.parse(localStorage.getItem("likedPosts")||"[]");
    const alreadyLiked = likedPosts.includes(p.id);
    box.innerHTML += \`
      <div class="card-post">
        <div class="card-header">
          <img class="avatar" src="/img/\${p.avatar||'xxx.png'}">
          <strong>\${p.prenom}</strong>
        </div>
        <div class="card-content">
          <p>\${p.texte}</p>
          \${p.image?'<img src="/img/'+p.image+'" class="post-image">':''}
        </div>
        <div class="card-actions">
          <button class="btn btn-outline-primary btn-sm" onclick="likePost(\${p.id},\${alreadyLiked})">👍 <span id="likes-\${p.id}">\${p.likes_count}</span></button>
          <a href="/publication/post/\${p.id}" class="btn btn-outline-secondary btn-sm">💬 (\${p.comments_count})</a>
        </div>
        <div class="small-text">\${new Date(p.date_creation).toLocaleString()}</div>
      </div>
    \`;
  });
}

function applySearch(){
  const query = document.getElementById("searchInput").value.trim().toLowerCase();
  const filtered = allPosts.filter(p=>p.texte.toLowerCase().includes(query) || (p.prenom||'').toLowerCase().includes(query));
  renderPosts(filtered);
}

async function likePost(postId, alreadyLiked){
  if(alreadyLiked){openModal(i18n[lang].already_liked);return;}
  await fetch('/api/posts/'+postId+'/like',{method:'POST'});
  let likedPosts = JSON.parse(localStorage.getItem("likedPosts")||"[]");
  likedPosts.push(postId);
  localStorage.setItem("likedPosts", JSON.stringify(likedPosts));
  fetchPosts();
}

const modal = document.getElementById("modalIOS");
const backdrop = document.getElementById("modalBackdrop");
function openModal(message){modal.style.display='block';backdrop.style.display='block';document.getElementById("modalMessage").textContent=message;}
function closeModal(){modal.style.display='none';backdrop.style.display='none';}

fetchPosts();
</script>
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>`);
});







app.get("/publication/post/:id", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const postId = req.params.id;
  const userId = req.session.user.id;

  const postSql = `
    SELECT p.id, p.texte, p.image, p.date_creation, u.prenom
    FROM posts p
    LEFT JOIN users u ON u.id = p.id_users
    WHERE p.id = ?
  `;

  db.query(postSql, [postId], (err, postRows) => {
    if (err || !postRows.length) return res.send("Publication introuvable");
    const post = postRows[0];

    const commentsSql = `
      SELECT c.id, c.texte, c.date_creation, c.id_users, u.prenom
      FROM comments c
      LEFT JOIN users u ON u.id = c.id_users
      WHERE c.id_post = ?
      ORDER BY c.date_creation ASC
    `;

    db.query(commentsSql, [postId], (err2, comments) => {
      if (err2) return res.send("Erreur commentaires");

res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Discussion</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">

<style>
body{
  margin:0;
  height:100vh;
  display:flex;
  flex-direction:column;
  background:#f0f2f5;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI";
}

/* ===== HEADER FIXE ===== */
.header{
  position:sticky;
  top:0;
  z-index:100;
  background:#fff;
  padding:10px;
  display:flex;
  align-items:center;
  gap:10px;
  border-bottom:1px solid #ddd;
}

.header img{
  width:42px;
  height:42px;
  border-radius:50%;
  object-fit:cover;
}

.post-text{
  font-size:13px;
  line-height:1.4;
  max-height:3.6em;
  overflow:hidden;
}

.post-text.expanded{max-height:none;}
.read-more{font-size:12px;color:#0b5ed7;cursor:pointer}

/* ===== MESSAGES ===== */
.messages{
  flex:1;
  overflow-y:auto;
  padding:15px;
  display:flex;
  flex-direction:column;
}

.bubble{
  padding:10px 14px;
  margin-bottom:10px;
  border-radius:18px;
  font-size:14px;
  word-break:break-word;
  width:fit-content;
  max-width:75%;
  min-width:40px;
}

.left{
  background:#fff;
  align-self:flex-start;
  border-top-left-radius:6px;
}

.right{
  background:#0b5ed7;
  color:#fff;
  align-self:flex-end;
  border-top-right-radius:6px;
}

.meta{
  font-size:11px;
  opacity:.7;
  margin-top:4px;
}

.back-arrow{
  font-size:26px;
  font-weight:600;
  cursor:pointer;
  color:#0b5ed7;
  margin-right:6px;
  user-select:none;
}


.actions{
  display:flex;
  gap:12px;
  font-size:12px;
  margin-top:5px;
}

.actions span{cursor:pointer;opacity:.8}

/* ===== INPUT IOS ===== */
.form-box{
  padding:10px;
  display:flex;
  gap:8px;
  border-top:1px solid #ccc;
  background:#fff;
}

.ios-input{
  flex:1;
  height:42px;
  border-radius:20px;
  padding:10px 14px;
  border:1px solid #ccc;
  resize:none;
  font-size:14px;
  overflow:hidden;
}

.ios-input::-webkit-scrollbar{display:none}

.send-btn{
  width:42px;
  height:42px;
  border-radius:50%;
  border:none;
  background:#0b5ed7;
  color:#fff;
  font-size:18px;
}

/* ===== MODAL IOS ===== */
.modal-ios-backdrop{
  position:fixed;inset:0;
  background:rgba(0,0,0,.4);
  display:none;z-index:999;
}
.modal-ios{
  position:fixed;top:50%;left:50%;
  transform:translate(-50%,-50%);
  background:#fff;
  border-radius:16px;
  padding:20px;
  width:90%;max-width:320px;
  display:none;z-index:1000;
  text-align:center;
}
.modal-ios textarea{
  width:100%;border-radius:12px;
  padding:8px;border:1px solid #ccc;
}
.modal-ios .btns{
  display:flex;justify-content:space-between;margin-top:15px;
}
.modal-ios button{
  border:none;border-radius:12px;
  padding:6px 14px;
}
.confirm{background:#0b5ed7;color:#fff}
.cancel{background:#ccc}

.sender-name{
  font-size:12px;
  font-weight:600;
  margin-bottom:3px;
  color:#555;
}

</style>
</head>

<body>

<!-- HEADER -->
<div class="header">
  <span class="back-arrow" onclick="window.location.href='/publication/social'">‹</span>

  ${post.image ? `<img src="/img/${post.image}">` : ``}

  <div>
    <strong>${post.prenom}</strong>
    <div id="postText" class="post-text">${post.texte}</div>
    ${post.texte.length > 180 ? `<div class="read-more" onclick="toggleText()">Lire plus</div>` : ``}
  </div>
</div>


<!-- MESSAGES -->
<div class="messages" id="messages">
${comments.map(c=>`
<div class="bubble ${c.id_users===userId?'right':'left'}" data-id="${c.id}">
  
  ${c.id_users!==userId ? `
    <div class="sender-name">${c.prenom || 'Utilisateur'}</div>
  ` : ``}

  <div class="text">${c.texte}</div>

  <div class="meta">${new Date(c.date_creation).toLocaleString()}</div>

  ${c.id_users===userId?`
    <div class="actions">
      <span onclick="openEdit(${c.id})">✏️ Modifier</span>
      <span onclick="openDelete(${c.id})">🗑️ Supprimer</span>
    </div>
  `:''}
</div>
`).join("")}
</div>

<!-- INPUT -->
<form class="form-box" onsubmit="sendComment(event)">
  <textarea id="text" class="ios-input" placeholder="Votre commentaire..." maxlength="500" required></textarea>
  <button class="send-btn">➤</button>
</form>

<!-- MODAL IOS -->
<div class="modal-ios-backdrop" id="backdrop"></div>
<div class="modal-ios" id="modal">
  <h6 id="modalTitle"></h6>
  <textarea id="modalText"></textarea>
  <div class="btns">
    <button class="cancel" onclick="closeModal()">Annuler</button>
    <button class="confirm" onclick="confirmAction()">OK</button>
  </div>
</div>

<script>
const postId=${postId};
let action=null,id=null;

function toggleText(){
  document.getElementById("postText").classList.toggle("expanded");
}

function sendComment(e){
  e.preventDefault();
  fetch("/api/posts/"+postId+"/comment",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({texte:text.value.trim()})
  }).then(()=>location.reload());
}

function openEdit(cid){
  action="edit";id=cid;
  modalTitle.innerText="Modifier le message";
  modalText.value=document.querySelector('[data-id="'+cid+'"] .text').innerText;
  showModal();
}

function openDelete(cid){
  action="delete";id=cid;
  modalTitle.innerText="Supprimer ce message ?";
  modalText.value="";
  modalText.style.display="none";
  showModal();
}

function confirmAction(){
  if(action==="edit"){
    fetch("/api/comments/"+id,{
      method:"PUT",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({texte:modalText.value})
    }).then(()=>location.reload());
  }
  if(action==="delete"){
    fetch("/api/comments/"+id,{method:"DELETE"})
      .then(()=>location.reload());
  }
}

function showModal(){
  modal.style.display="block";
  backdrop.style.display="block";
}
function closeModal(){
  modal.style.display="none";
  backdrop.style.display="none";
  modalText.style.display="block";
}
messages.scrollTop=999999;
</script>

</body>
</html>`);
    });
  });
});



// Modifier un commentaire
app.put("/api/comments/:id", (req, res) => {
  if (!req.session.user) return res.status(401).json({success: false, message: "Non autorisé"});

  const commentId = req.params.id;
  const userId = req.session.user.id;
  const { texte } = req.body;

  if (!texte || texte.trim() === "") return res.status(400).json({success:false, message:"Texte vide"});

  const sql = "UPDATE comments SET texte = ? WHERE id = ? AND id_users = ?";
  db.query(sql, [texte, commentId, userId], (err, result) => {
    if (err) return res.status(500).json({success:false, message:"Erreur serveur"});
    if (result.affectedRows === 0) return res.status(403).json({success:false, message:"Impossible de modifier ce commentaire"});
    res.json({success:true});
  });
});

// Supprimer un commentaire
app.delete("/api/comments/:id", (req, res) => {
  if (!req.session.user) return res.status(401).json({success:false, message:"Non autorisé"});

  const commentId = req.params.id;
  const userId = req.session.user.id;

  const sql = "DELETE FROM comments WHERE id = ? AND id_users = ?";
  db.query(sql, [commentId, userId], (err, result) => {
    if (err) return res.status(500).json({success:false, message:"Erreur serveur"});
    if (result.affectedRows === 0) return res.status(403).json({success:false, message:"Impossible de supprimer ce commentaire"});
    res.json({success:true});
  });
});







  















app.get("/contact/send-mail", (req, res) => { 
  if (!req.session.user) return res.redirect("/login");

  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Service Client - ASSHA</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"/>

<style>
body{
  background:#f4f6fa;
  font-family:Segoe UI,Tahoma,Geneva,Verdana,sans-serif;
}
.navbar-brand img{
  height:40px;
  border-radius:50%;
  margin-right:10px;
}

/* SECTION PRINCIPALE – STYLE IOS */
.section{
  background:#fff;
  max-width:720px;
  margin:40px auto;
  padding:30px;
  border-radius:18px;
  text-align:center;
}

/* TITRE */
.section h2{
  color:#0b57d0;
  font-weight:700;
  margin-bottom:10px;
}

/* IMAGE RESPONSIVE */
.contact-image img{
  width:100%;
  max-height:300px;
  height:auto;
  object-fit:cover;
  border-radius:12px;
  margin:20px 0;
  box-shadow:none;
}

/* TEXTE */
.section p{
  color:#555;
  font-size:1rem;
  margin-bottom:25px;
}

/* CONTACT ITEMS */
.contact-item{
  display:flex;
  align-items:center;
  justify-content:center;
  gap:15px;
  margin-bottom:15px;
  font-size:1.05rem;
}
.contact-item i{
  font-size:1.8rem;
  color:#0b57d0;
}

/* BOUTONS */
.btn-contact{
  width:100%;
  max-width:260px;
  margin:8px auto;
  border-radius:14px;
  display:flex;
  align-items:center;
  justify-content:center;
  gap:10px;
}

/* RESPONSIVE */
@media(max-width:768px){
  .section{margin:25px 15px;padding:25px;}
}
</style>
</head>
<body>

<nav class="navbar navbar-expand-lg navbar-dark bg-primary shadow">
<div class="container-fluid">
<a class="navbar-brand fw-bold d-flex align-items-center" href="/forum">
<img src="/img/log2.jpg" style="height:40px;border-radius:50%;margin-right:10px;">ASSHA
</a>
<button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarContent">
<span class="navbar-toggler-icon"></span>
</button>
<div class="collapse navbar-collapse" id="navbarContent">
<ul class="navbar-nav me-auto">
<li class="nav-item"><a class="nav-link" href="/poster-video" data-i18n="nav_video">Poster vidéo</a></li>
<li class="nav-item dropdown"><a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_forum">Forum</a>
<ul class="dropdown-menu">
<li><a class="dropdown-item" href="/forum/new-topic" data-i18n="nav_post_topic">Poster un sujet</a></li>
<li><a class="dropdown-item" href="/forum/topics" data-i18n="nav_view_topics">Consulter les sujets</a></li>
<li><a class="dropdown-item" href="/forum/my-topics" data-i18n="nav_my_topics">Mes sujets</a></li>
</ul></li>
<li class="nav-item dropdown">
<a class="nav-link dropdown-toggle active" href="#" data-bs-toggle="dropdown" data-i18n="nav_payment">Paiement</a>
<ul class="dropdown-menu">
<li><a class="dropdown-item" href="/paiement/contribution" data-i18n="nav_contribution">Contribution</a></li>
<li><a class="dropdown-item active" href="/paiement/donation" data-i18n="nav_donation">Faire un don</a></li>
<li><a class="dropdown-item" href="/paiement/journal" data-i18n="nav_journal">Journal</a></li>
</ul></li>
<li class="nav-item dropdown"><a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_publication">Publication</a>
<ul class="dropdown-menu"><li><a class="dropdown-item" href="/publication/social">Social</a></li></ul></li>
<li class="nav-item dropdown"><a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="nav_contact">Contact</a>
<ul class="dropdown-menu"><li><a class="dropdown-item" href="/contact/send-mail">Envoyer un email</a></li></ul></li>
<li class="nav-item"><a class="nav-link" href="/bibliotheque" data-i18n="nav_library">Bibliothèque</a></li>
</ul>
</div></div></nav>

<div class="section">
<h2 id="sectionTitle">Service Client</h2>

<div class="contact-image">
<img src="/img/phone.jpg" alt="Service Client">
</div>

<p id="sectionDesc">
Contactez notre équipe pour toute assistance, question ou suggestion.
</p>

<div class="contact-item">
<i class="fas fa-phone"></i>
<span id="phoneText">+243 999 111 222</span>
</div>

<a href="tel:+243999111222" class="btn btn-primary btn-contact">
<i class="fas fa-phone"></i> <span id="phoneBtnText">Appeler maintenant</span>
</a>

<div class="contact-item mt-3">
<i class="fas fa-envelope"></i>
<span id="userEmail">contact@assha.org</span>
</div>

<a id="emailBtn" class="btn btn-outline-primary btn-contact">
<i class="fas fa-envelope"></i> <span id="emailBtnText">Envoyer un email</span>
</a>

<p class="mt-4 text-muted" id="hoursText">
Heures d'assistance : Lundi - Vendredi, 08h00 - 17h00
</p>
</div>

<script>
const lang = localStorage.getItem("lang") || "fr";
const userName = localStorage.getItem("prenom") || "";
const userEmail = localStorage.getItem("email") || "contact@assha.org";

const texts = {
  fr:{
    sectionTitle:"Service Client - ",
    sectionDesc:"Contactez notre équipe pour toute assistance, question ou suggestion.",
    phoneText:"+243 999 111 222",
    phoneBtnText:"Appeler maintenant",
    emailBtnText:"Envoyer un email",
    hoursText:"Heures d'assistance : Lundi - Vendredi, 08h00 - 17h00"
  },
  en:{
    sectionTitle:"Customer Service - ",
    sectionDesc:"Contact our team for any assistance, questions, or suggestions.",
    phoneText:"+243 999 111 222",
    phoneBtnText:"Call now",
    emailBtnText:"Send Email",
    hoursText:"Support hours: Monday - Friday, 08:00 - 17:00"
  }
};

const t = texts[lang];
document.getElementById("sectionTitle").textContent = t.sectionTitle + userName;
document.getElementById("sectionDesc").textContent = t.sectionDesc;
document.getElementById("phoneText").textContent = t.phoneText;
document.getElementById("phoneBtnText").textContent = t.phoneBtnText;
document.getElementById("userEmail").textContent = userEmail;
document.getElementById("emailBtnText").textContent = t.emailBtnText;
document.getElementById("hoursText").textContent = t.hoursText;

document.getElementById("emailBtn").addEventListener("click", ()=>{
  window.location.href = "mailto:" + userEmail;
});
</script>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>`);
});






// Assure-toi que ton dossier public contient un sous-dossier img_books avec les images des livres
app.use("/img_books", express.static(__dirname + "/img_books"));

app.get("/bibliotheque", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const sql = `SELECT * FROM books ORDER BY id DESC`;
  db.query(sql, (err, books) => {
    if (err) {
      console.error("Erreur récupération livres :", err);
      return res.send("Erreur serveur");
    }

    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Bibliothèque</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
<style>
/* Fond précédent conservé */
body {
  background:#f4f6fa;
  font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;
  margin:0;
  padding:0;
}

/* Navbar logo */
.navbar-brand img{margin-right:10px;height:40px;border-radius:50%;}

/* Input recherche bleu ciel doux */
#searchInput{
  margin-bottom:20px;
  border-radius:15px;
  border:1px solid #cce0ff;
  background-color:#d9eeff;
  padding:10px 15px;
  transition: all 0.3s ease;
}
#searchInput:focus{
  outline:none;
  box-shadow:0 0 8px rgba(12,128,255,0.3);
  border-color:#0c80ff;
}

/* Cartes iOS pro */
.card-book{
  background:#fff;
  border-radius:20px;
  overflow:hidden;
  box-shadow:0 15px 35px rgba(0,0,0,0.08),0 6px 12px rgba(0,0,0,0.05);
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}
.card-book:hover{
  transform:translateY(-6px);
  box-shadow:0 25px 50px rgba(0,0,0,0.12),0 10px 20px rgba(0,0,0,0.06);
}
.card-book img{
  width:100%;
  height:220px;
  object-fit:cover;
  transition: transform 0.3s ease;
}
.card-book img:hover{transform:scale(1.05);}
.card-body{padding:15px;}
.card-body h5{font-size:1.1rem;color:#0b57d0;margin-bottom:5px;font-weight:bold;}
.card-body p{margin:3px 0;color:#555;font-size:0.9rem;}
.btn-view{
  background:#0b57d0;
  color:#fff;
  border-radius:12px;
  width:100%;
  transition: all 0.3s ease;
}
.btn-view:hover{
  background:#0941a2;
  color:#fff;
  transform:translateY(-2px);
  box-shadow:0 6px 18px rgba(0,0,0,0.12);
}

/* Responsive */
@media (min-width:576px){.card-book img{height:200px;}}
@media (min-width:768px){.card-book img{height:180px;}}
@media (min-width:992px){.card-book img{height:160px;}}
</style>
</head>
<body>

<!-- NAVBAR -->
<nav class="navbar navbar-expand-lg navbar-dark bg-primary shadow">
<div class="container-fluid">
<a class="navbar-brand d-flex align-items-center" href="/forum">
<img src="/img/log2.jpg" alt="Logo">ASSHA
</a>
<button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarContent">
<span class="navbar-toggler-icon"></span>
</button>
<div class="collapse navbar-collapse" id="navbarContent">
<ul class="navbar-nav me-auto">
<li class="nav-item"><a class="nav-link" href="/poster-video" id="navPosterVideo">Poster vidéo</a></li>
<li class="nav-item dropdown">
  <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" id="navForum">Forum</a>
  <ul class="dropdown-menu">
    <li><a class="dropdown-item" href="/forum/new-topic" id="navForumNew">Poster un sujet</a></li>
    <li><a class="dropdown-item" href="/forum/topics" id="navForumTopics">Consulter les sujets</a></li>
    <li><a class="dropdown-item" href="/forum/my-topics" id="navForumMy">Mes sujets</a></li>
  </ul>
</li>
<li class="nav-item dropdown">
  <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" id="navPaiement">Paiement</a>
  <ul class="dropdown-menu">
    <li><a class="dropdown-item" href="/paiement/contribution" id="navContribution">Contribution</a></li>
    <li><a class="dropdown-item" href="/paiement/donation" id="navDonation">Faire un don</a></li>
    <li><a class="dropdown-item" href="/paiement/journal" id="navJournal">Journal</a></li>
  </ul>
</li>
<li class="nav-item dropdown">
  <a class="nav-link dropdown-toggle active" href="#" data-bs-toggle="dropdown" id="navPublication">Publication</a>
  <ul class="dropdown-menu">
    <li><a class="dropdown-item" href="/publication/social" id="navSocial">Social</a></li>
  </ul>
</li>
<li class="nav-item dropdown">
  <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" id="navContact">Contact</a>
  <ul class="dropdown-menu">
    <li><a class="dropdown-item" href="/contact/send-mail" id="navServiceClient">Service Client</a></li>
  </ul>
</li>
<li class="nav-item"><a class="nav-link active" href="/bibliotheque" id="navBibliotheque">Bibliothèque</a></li>
</ul>
</div>
</div></nav>

<div class="container mt-4">
<h2 class="mb-3" id="pageTitle">Bibliothèque</h2>
<input type="text" id="searchInput" class="form-control" placeholder="Rechercher un livre par titre ou catégorie...">
<div class="row g-4" id="booksContainer">
${books.map(book => `
<div class="col-12 col-sm-6 col-md-4 col-lg-3 book-card">
  <div class="card-book">
    <img src="/img_books/${book.image}" alt="${book.titre}">
    <div class="card-body">
      <h5>${book.titre}</h5>
      <p class="book-category">Catégorie: ${book.categorie}</p>
      <p class="book-price">Prix: ${book.prix} USD</p>
      <a href="/bibliotheque/book/${book.id}" class="btn btn-view mt-2" id="viewBtn">Voir / Acheter</a>
    </div>
  </div>
</div>`).join('')}
</div>
</div>

<script>
// Traductions dynamiques
const lang = localStorage.getItem("lang") || "fr";
const texts = {
  fr: {pageTitle:"Bibliothèque", searchPlaceholder:"Rechercher un livre par titre ou catégorie...", categoryText:"Catégorie", priceText:"Prix", viewBtn:"Voir / Acheter"},
  en: {pageTitle:"Library", searchPlaceholder:"Search a book by title or category...", categoryText:"Category", priceText:"Price", viewBtn:"View / Buy"}
};
const t = texts[lang];
document.getElementById("pageTitle").textContent = t.pageTitle;
document.getElementById("searchInput").placeholder = t.searchPlaceholder;
document.querySelectorAll('.book-card').forEach(card => {
  card.querySelector('.book-category').textContent = t.categoryText + ": " + card.querySelector('.book-category').textContent.split(': ')[1];
  card.querySelector('.book-price').textContent = t.priceText + ": " + card.querySelector('.book-price').textContent.split(': ')[1];
  card.querySelector('#viewBtn').textContent = t.viewBtn;
});

// Recherche dynamique
const searchInput = document.getElementById('searchInput');
searchInput.addEventListener('input', function(){
  const filter = this.value.toLowerCase();
  document.querySelectorAll('.book-card').forEach(card => {
    const title = card.querySelector('h5').textContent.toLowerCase();
    const category = card.querySelector('.book-category').textContent.toLowerCase();
    card.style.display = (title.includes(filter) || category.includes(filter)) ? '' : 'none';
  });
});
</script>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>`);

  });
});




app.get("/bibliotheque/book/:id", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const bookId = req.params.id;
  const sql = `SELECT * FROM books WHERE id = ?`;
  db.query(sql, [bookId], (err, results) => {
    if (err) return res.send("Erreur serveur");
    if (results.length === 0) return res.send("Livre introuvable");

    const book = results[0];

    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>${book.titre}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
<style>
body {background:#f4f6fa;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;margin:0;padding:0;}
.book-container {max-width:520px;width:95%;margin:50px auto;background:#fff;border-radius:25px;box-shadow:0 15px 35px rgba(0,0,0,0.1);overflow:hidden;text-align:center;}
.book-image-wrapper {width:100%;background:#e6f0ff;padding:25px 0;}
.book-image-wrapper img {width:220px;height:300px;border-radius:20px;box-shadow:0 10px 25px rgba(0,0,0,0.08);object-fit:cover;}
.book-details {padding:20px;text-align:center;}
.book-details h2 {font-size:1.6rem;color:#0b57d0;font-weight:600;margin-bottom:15px;word-wrap: break-word;}
.book-details p {font-size:1rem;color:#333;margin-bottom:10px;line-height:1.5;word-wrap: break-word;}
.btn-buy {display:block;width:90%;max-width:300px;margin:25px auto 15px;padding:15px;font-size:1.1rem;font-weight:600;color:#fff;border:none;border-radius:20px;cursor:pointer;background: linear-gradient(135deg, #4facfe, #00f2fe);transition: all 0.3s ease;}
.btn-buy:hover {transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0,0,0,0.2);}
.modal-ios .modal-content {border-radius:20px;text-align:center;padding:25px;background:#fff;box-shadow:0 5px 25px rgba(0,0,0,0.2);}
.modal-ios .modal-footer {justify-content:center;border-top:none;}
.modal-ios .btn-primary {background:#007aff;color:#fff;border-radius:15px;width:80%;max-width:200px;}
.navbar-brand img {height:40px;width:40px;border-radius:50%;margin-right:10px;}
@media (max-width:768px){.book-image-wrapper img{width:180px;height:250px;} .book-details h2{font-size:1.4rem;}}
@media (max-width:480px){.book-image-wrapper img{width:150px;height:210px;} .book-details h2{font-size:1.2rem;}}
</style>
</head>
<body>

<!-- NAVBAR -->
<nav class="navbar navbar-expand-lg navbar-dark bg-primary shadow">
  <div class="container">
    <a class="navbar-brand d-flex align-items-center" href="/forum">
      <img src="/img/log2.jpg" alt="Logo">
      <span class="fw-bold text-white">ASSHA</span>
    </a>
    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarContent">
      <span class="navbar-toggler-icon"></span>
    </button>
    <div class="collapse navbar-collapse" id="navbarContent">
      <ul class="navbar-nav ms-auto">
        <li class="nav-item"><a class="nav-link" data-i18n="posterVideo" href="/poster-video">Poster vidéo</a></li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="forum">Forum</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item" data-i18n="postTopic" href="/forum/new-topic">Poster un sujet</a></li>
            <li><a class="dropdown-item" data-i18n="viewTopics" href="/forum/topics">Consulter les sujets</a></li>
            <li><a class="dropdown-item" data-i18n="myTopics" href="/forum/my-topics">Mes sujets</a></li>
          </ul>
        </li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="paiement">Paiement</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item" data-i18n="contribution" href="/paiement/contribution">Contribution</a></li>
            <li><a class="dropdown-item" data-i18n="donation" href="/paiement/donation">Faire un don</a></li>
            <li><a class="dropdown-item" data-i18n="journal" href="/paiement/journal">Journal</a></li>
          </ul>
        </li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="publication">Publication</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item" data-i18n="social" href="/publication/social">Social</a></li>
          </ul>
        </li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" data-i18n="contact">Contact</a>
          <ul class="dropdown-menu">
            <li><a class="dropdown-item" data-i18n="serviceClient" href="/contact/send-mail">Service Client</a></li>
          </ul>
        </li>
        <li class="nav-item"><a class="nav-link active" data-i18n="bibliotheque" href="/bibliotheque">Bibliothèque</a></li>
      </ul>
    </div>
  </div>
</nav>

<!-- BOOK -->
<div class="container book-container">
  <div class="book-image-wrapper">
    <img src="/img_books/${book.image}" alt="${book.titre}">
  </div>
  <div class="book-details">
    <h2>${book.titre}</h2>
    <p><strong>Catégorie :</strong> ${book.categorie}</p>
    <p><strong>Prix :</strong> ${book.prix} USD</p>
    <p>${book.description}</p>
    <button class="btn-buy" data-bs-toggle="modal" data-bs-target="#passwordModal">Acheter maintenant</button>
  </div>
</div>

<!-- Modal mot de passe -->
<div class="modal fade" id="passwordModal" tabindex="-1">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-header justify-content-center border-0">
        <h5 class="modal-title">Confirmer l'achat</h5>
      </div>
      <div class="modal-body">
        <label>Mot de passe</label>
        <input type="password" id="userPassword" class="form-control mb-3" placeholder="Entrez votre mot de passe">
        <label>Choisir un opérateur</label>
        <select id="operateurSelect" class="form-select">
          <option value="">Choisir un opérateur</option>
          <option value="Airtel">Airtel</option>
          <option value="Vodacom">Vodacom</option>
          <option value="Orange">Orange</option>
        </select>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary w-75" onclick="verifierPassword()">Valider</button>
      </div>
    </div>
  </div>
</div>

<!-- Modal iOS mot de passe incorrect -->
<div class="modal fade modal-ios" id="wrongPasswordModal" tabindex="-1">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-body">
        <p id="wrongPasswordText" style="font-weight:600;color:#ff3b30;"></p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" data-bs-dismiss="modal">OK</button>
      </div>
    </div>
  </div>
</div>

<!-- Modal iOS numéro opérateur -->
<div class="modal fade modal-ios" id="numeroModal" tabindex="-1">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-body">
        <p id="numeroText" style="font-weight:600;color:#28a745;"></p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" data-bs-dismiss="modal">OK</button>
      </div>
    </div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
<script>
const bookId = ${book.id};

// Traductions FR/EN pour navbar et page
const i18n = {
  fr: {
    posterVideo: "Poster vidéo",
    forum: "Forum",
    postTopic: "Poster un sujet",
    viewTopics: "Consulter les sujets",
    myTopics: "Mes sujets",
    paiement: "Paiement",
    contribution: "Contribution",
    donation: "Faire un don",
    journal: "Journal",
    publication: "Publication",
    social: "Social",
    contact: "Contact",
    serviceClient: "Service Client",
    bibliotheque: "Bibliothèque",
    buyNow: "Acheter maintenant",
    confirmPurchase: "Confirmer l'achat",
    enterPassword: "Entrez votre mot de passe",
    chooseOperator: "Choisir un opérateur",
    passwordRequired: "Veuillez entrer votre mot de passe et choisir un opérateur",
    purchaseConfirmed: "Achat confirmé ! Contactez le numéro :",
    ok: "OK"
  },
  en: {
    posterVideo: "Post video",
    forum: "Forum",
    postTopic: "Post topic",
    viewTopics: "View topics",
    myTopics: "My topics",
    paiement: "Payment",
    contribution: "Contribution",
    donation: "Donate",
    journal: "Journal",
    publication: "Publication",
    social: "Social",
    contact: "Contact",
    serviceClient: "Customer service",
    bibliotheque: "Library",
    buyNow: "Buy now",
    confirmPurchase: "Confirm purchase",
    enterPassword: "Enter your password",
    chooseOperator: "Choose an operator",
    passwordRequired: "Please enter your password and choose an operator",
    purchaseConfirmed: "Purchase confirmed! Contact number:",
    ok: "OK"
  }
};

// Appliquer la langue depuis localStorage
function applyLang() {
  const lang = localStorage.getItem("lang") || "fr";
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n;
    if(i18n[lang][key]) el.textContent = i18n[lang][key];
  });
  document.querySelector('.btn-buy').textContent = i18n[lang].buyNow;
  document.querySelector('#passwordModal .modal-title').textContent = i18n[lang].confirmPurchase;
  document.getElementById('userPassword').placeholder = i18n[lang].enterPassword;
  document.querySelector('#operateurSelect option[value=""]').textContent = i18n[lang].chooseOperator;
  document.querySelector('#wrongPasswordModal .btn').textContent = i18n[lang].ok;
  document.querySelector('#numeroModal .btn').textContent = i18n[lang].ok;
}
applyLang();

function verifierPassword() {
  const pwd = document.getElementById('userPassword').value;
  const operateur = document.getElementById('operateurSelect').value;
  const lang = localStorage.getItem("lang") || "fr";
  if(!pwd || !operateur){ 
    const wrongModal = new bootstrap.Modal(document.getElementById('wrongPasswordModal'));
    document.getElementById('wrongPasswordText').innerText = i18n[lang].passwordRequired;
    wrongModal.show();
    return; 
  }

  fetch('/verif-password', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ password: pwd, bookId: bookId, operateur: operateur })
  }).then(res=>res.json())
    .then(data=>{
      if(data.success){
        const numeroModal = new bootstrap.Modal(document.getElementById('numeroModal'));
        document.getElementById('numeroText').innerText = i18n[lang].purchaseConfirmed + ' ' + data.numero_operateur;
        numeroModal.show();
        bootstrap.Modal.getInstance(document.getElementById('passwordModal')).hide();
      } else {
        const wrongModal = new bootstrap.Modal(document.getElementById('wrongPasswordModal'));
        document.getElementById('wrongPasswordText').innerText = data.message || i18n[lang].passwordRequired;
        wrongModal.show();
      }
    }).catch(err=>{
      console.error(err);
      const wrongModal = new bootstrap.Modal(document.getElementById('wrongPasswordModal'));
      document.getElementById('wrongPasswordText').innerText = 'Erreur serveur';
      wrongModal.show();
    });
}
</script>
</body>
</html>
`);
  });
});


// POST vérification mot de passe (en clair)
app.post('/verif-password', (req, res) => {
  const userId = req.session.user.id;
  const { password, bookId, operateur } = req.body;

  if (!password || !bookId || !operateur)
    return res.json({ success: false, message: "Données manquantes" });

  db.query('SELECT mot_de_passe FROM users WHERE id = ?', [userId], (err, results) => {
    if(err || results.length === 0) return res.json({ success: false });

    const motDePasse = results[0].mot_de_passe;

    if(password !== motDePasse){
      return res.json({ success: false, message: "Mot de passe incorrect" });
    }

    const numeros = { Airtel: '+243 820 123 456', Vodacom: '+243 850 654 321', Orange: '+243 890 987 654' };
    const numero_operateur = numeros[operateur];

    db.query('SELECT prix FROM books WHERE id = ?', [bookId], (err2, bookResults) => {
      if(err2 || bookResults.length === 0) return res.json({ success: false, message: "Livre introuvable" });

      const prix = bookResults[0].prix;

      db.query('INSERT INTO achat (user_id, book_id, operateur, numero_operateur, montant) VALUES (?, ?, ?, ?, ?)',
        [userId, bookId, operateur, numero_operateur, prix],
        (err3) => {
          if(err3) return res.json({ success: false, message: "Erreur lors de l'enregistrement de l'achat" });
          res.json({ success: true, numero_operateur });
        });
    });
  });
});










app.get("/login", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Connexion — ASSHA</title>
<meta name="viewport" content="width=device-width, initial-scale=1">

<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">

<style>
body {
    margin: 0;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    background: linear-gradient(135deg, #eef2f9, #d4e3f7);
    display: flex;
    flex-direction: column;
    min-height: 100vh;
}

/* Navbar */
.navbar { background:#0b57d0 !important; }
.navbar .navbar-brand, .navbar .nav-link { color: #fff !important; }
.navbar .nav-link:hover { opacity:0.8; }

/* Form Card */
.card {
    background: #ffffff;
    padding: 50px 35px;
    width: 100%;
    max-width: 400px;
    border-radius: 20px;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
    text-align: center;
    margin: 40px auto;
}

.card img {
    height: 80px;
    width: 80px;
    margin-bottom: 25px;
    border-radius: 50%;
    object-fit: cover;
    display: block;
    margin-left: auto;
    margin-right: auto;
}

form { width: 100%; }

label { display: block; text-align: left; font-weight: 600; color: #333; margin-bottom: 6px; }

input {
    width: 100%;
    padding: 14px 12px;
    margin-bottom: 20px;
    border-radius: 12px;
    border: 1px solid #ccc;
    font-size: 15px;
    box-sizing: border-box;
    transition: all 0.3s ease;
}

input:focus {
    border-color: #0b57d0;
    box-shadow: 0 0 8px rgba(11, 87, 208, 0.3);
    outline: none;
}

button {
    width: 100%;
    padding: 15px;
    background: #0b57d0;
    border: none;
    border-radius: 12px;
    color: white;
    font-size: 18px;
    font-weight: bold;
    cursor: pointer;
    transition: all 0.3s ease;
}

button:hover {
    background: #094bb5;
    transform: translateY(-2px);
}

.footer { margin-top: 25px; font-size: 14px; }
.footer a { color: #0b57d0; text-decoration: none; font-weight: 600; }
.footer a:hover { text-decoration: underline; }

.error { color: #e74c3c; margin-bottom: 15px; }

/* Modal iOS */
.modal-ios .modal-content { border-radius: 20px; }
.modal-ios .modal-footer { justify-content:center; border-top:none; }
.modal-ios .btn-primary { border-radius:15px; width:80%; max-width:200px; }

@media (max-width: 480px) {
    .card { padding: 35px 25px; }
}
</style>
</head>

<body>

<!-- Navbar complet -->
<nav class="navbar navbar-expand-lg">
<div class="container-fluid">
  <a class="navbar-brand d-flex align-items-center" href="/forum">
    <img src="/img/log2.jpg" style="height:40px;width:40px;border-radius:50%;margin-right:10px;">
    <span id="navbarTitle">ASSHA</span>
  </a>
</div>
</nav>

<!-- Form Card -->
<div class="card">
  <img src="/img/log2.jpg" alt="Logo ASSHA">

  <form id="loginForm" method="POST" action="/login">
    <label id="labelEmail">Email</label>
    <input type="email" name="email" id="email" placeholder="Entrez votre email" required>

    <label id="labelPassword">Mot de passe</label>
    <input type="password" name="password" id="password" placeholder="Entrez votre mot de passe" required>

    <button type="submit" id="loginBtn">Se connecter</button>
  </form>

  <div class="footer" id="footerText">
    <p>Pas encore membre ? <a href="/profil/inscription-suite">Créer un compte</a></p>
  </div>
</div>

<!-- Modal iOS pour erreurs -->
<div class="modal fade modal-ios" id="loginErrorModal" tabindex="-1">
<div class="modal-dialog modal-dialog-centered">
<div class="modal-content">
<div class="modal-body text-center">
<p id="loginErrorText" class="fw-bold text-danger"></p>
</div>
<div class="modal-footer">
<button type="button" class="btn btn-primary" data-bs-dismiss="modal">OK</button>
</div>
</div></div></div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
<script>
// Lecture locale globale
const lang = localStorage.getItem("lang") || "fr";
const i18n = {
  fr: {
    navbarTitle:"ASSHA",
    labelEmail:"Email",
    labelPassword:"Mot de passe",
    emailPlaceholder:"Entrez votre email",
    passwordPlaceholder:"Entrez votre mot de passe",
    loginBtn:"Se connecter",
    footerText:'Pas encore membre ? <a href="/profil/inscription-suite">Créer un compte</a>',
    loginErrorEmail:"Email incorrect",
    loginErrorPassword:"Mot de passe incorrect"
  },
  en: {
    navbarTitle:"ASSHA",
    labelEmail:"Email",
    labelPassword:"Password",
    emailPlaceholder:"Enter your email",
    passwordPlaceholder:"Enter your password",
    loginBtn:"Login",
    footerText:'Not a member yet? <a href="/profil/inscription-suite">Create an account</a>',
    loginErrorEmail:"Invalid email",
    loginErrorPassword:"Invalid password"
  }
};

// Appliquer à toute la page
document.getElementById("navbarTitle").textContent = i18n[lang].navbarTitle;
document.getElementById("labelEmail").textContent = i18n[lang].labelEmail;
document.getElementById("labelPassword").textContent = i18n[lang].labelPassword;
document.getElementById("email").placeholder = i18n[lang].emailPlaceholder;
document.getElementById("password").placeholder = i18n[lang].passwordPlaceholder;
document.getElementById("loginBtn").textContent = i18n[lang].loginBtn;
document.getElementById("footerText").innerHTML = i18n[lang].footerText;

// Modal erreurs
const loginErrorModal = new bootstrap.Modal(document.getElementById("loginErrorModal"));
const loginErrorText = document.getElementById("loginErrorText");

document.getElementById("loginForm").addEventListener("submit", function(e){
  e.preventDefault();
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  fetch('/login', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({email,password})
  })
  .then(res => res.json())
  .then(data=>{
    if(!data.success){
      loginErrorText.textContent = data.message || i18n[lang].loginErrorEmail;
      loginErrorModal.show();
    } else {
      window.location.href = "/forum";
    }
  })
  .catch(err=>{
    loginErrorText.textContent = "Erreur serveur";
    loginErrorModal.show();
    console.error(err);
  });
});
</script>
</body>
</html>`);
});














app.get("/profil/visite-bienfaisance", (req, res) => {
    res.send(`
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Visite de bienfaisance — ASSHA</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { margin:0; padding:20px; font-family: Arial, sans-serif; background: #eef2f9; }
            .card { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 18px; box-shadow: 0 10px 25px rgba(0,0,0,0.12); }
            h1 { text-align: center; color: #0b57d0; font-size: 28px; margin-bottom: 20px; }
            p { font-size: 17px; line-height: 1.6; color: #555; margin-bottom: 20px; }
            a.back-btn { display: block; text-align: center; margin-top: 25px; text-decoration: none; background: #0b57d0; color: white; padding: 14px 20px; border-radius: 10px; font-size: 18px; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1 id="pageTitle">Faire une visite de bienfaisance</h1>
            <p id="pageContent">Vous pouvez visiter nos actions et faire un don pour soutenir nos programmes humanitaires.</p>
            <a class="back-btn" id="backBtn" href="/profil">Retour</a>
        </div>
        <script>
            const lang = localStorage.getItem('lang') || 'fr';
            const titles = { fr: "Faire une visite de bienfaisance", en: "Visit as a guest to make a donation" };
            const contents = { 
                fr: "Vous pouvez visiter nos actions et faire un don pour soutenir nos programmes humanitaires.",
                en: "You can visit our activities and make a donation to support our humanitarian programs."
            };
            document.getElementById('pageTitle').textContent = titles[lang];
            document.getElementById('pageContent').textContent = contents[lang];
            document.getElementById('backBtn').textContent = lang === 'en' ? 'Back' : 'Retour';
        </script>
    </body>
    </html>
    `);
});


app.get("/profil/politique-confidentialite", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Politique de confidentialité — ASSHA</title>
<meta name="viewport" content="width=device-width, initial-scale=1">

<style>
*{box-sizing:border-box;margin:0;padding:0}

body{
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  background:#eef2f9;
  color:#222;
  overflow-x:hidden;
}

.header-bar{
  position:fixed;
  top:0;left:0;
  width:100%;
  height:clamp(52px,8vw,64px);
  background:#0b57d0;
  color:#fff;
  display:flex;
  align-items:center;
  justify-content:center;
  font-weight:600;
  font-size:clamp(0.95rem,3.5vw,1.15rem);
  z-index:1000;
  box-shadow:0 2px 6px rgba(0,0,0,.15);
}

.wrapper{
  padding-top:clamp(70px,12vw,90px);
  padding-bottom:clamp(90px,14vw,120px);
  display:flex;
  justify-content:center;
  padding-left:1rem;
  padding-right:1rem;
}

.card{
  width:100%;
  max-width:620px;
  background:#fff;
  border-radius:18px;
  box-shadow:0 8px 22px rgba(0,0,0,.12);
  padding:clamp(1rem,4vw,1.6rem);
}

.title{
  text-align:center;
  font-weight:700;
  font-size:clamp(1.35rem,5vw,1.9rem);
  margin-bottom:1.2rem;
}

.card img{
  width:100%;
  max-height:clamp(160px,40vw,240px);
  object-fit:cover;
  border-radius:14px;
  margin-bottom:1.4rem;
}

.content{
  line-height:1.75;
  font-size:clamp(.9rem,3.5vw,1.05rem);
}

.content h5{
  font-size:clamp(1rem,4vw,1.2rem);
  font-weight:700;
  margin:1.3rem 0 .6rem;
  color:#000;
}

.back-btn{
  position:fixed;
  bottom:clamp(10px,4vw,18px);
  left:50%;
  transform:translateX(-50%);
  width:min(90%,320px);
  padding:clamp(.65rem,3.5vw,.9rem);
  background:#28a745;
  color:#fff;
  font-weight:600;
  font-size:clamp(.9rem,4vw,1.05rem);
  text-decoration:none;
  border-radius:18px;
  display:flex;
  align-items:center;
  justify-content:center;
  gap:.5rem;
  box-shadow:0 4px 10px rgba(0,0,0,.25);
  transition:.25s ease;
  z-index:1000;
}

.back-btn:hover{
  background:#218838;
  transform:translateX(-50%) translateY(-3px);
  box-shadow:0 6px 14px rgba(0,0,0,.3);
}

@media(min-width:1024px){
  .back-btn{max-width:280px;font-size:.95rem}
}
</style>
</head>

<body>

<div class="header-bar" id="headerTitle">Politique de confidentialité</div>

<div class="wrapper">
  <div class="card">
    <div class="title" id="pageTitle">Politique de confidentialité</div>

    <img src="/img/dar.jpg" alt="ASSHA">

    <div class="content" id="pageContent"></div>
  </div>
</div>

<a href="/profil" class="back-btn">
  <span>←</span><span id="backText">Retour</span>
</a>

<script>
const lang = localStorage.getItem("lang") || "fr";

const texts = {
  fr:{
    title:"Politique de confidentialité",
    back:"Retour",
    content:\`
<h5>CONDITIONS GÉNÉRALES</h5>
Dernière mise à jour : [28 juin 2025]<br><br>

<h5>1. Collecte d’informations</h5>
ASSHA-CMTF collecte les informations suivantes : informations d’identification, informations de profil, contenu partagé, données d’utilisation.<br><br>

<h5>2. Utilisation des informations</h5>
Les informations sont utilisées pour fournir et améliorer les services, gérer les comptes, communiquer avec les utilisateurs et assurer la sécurité.<br><br>

<h5>3. Partage d'informations</h5>
Les données ne sont partagées qu’avec des prestataires de services ou autorités légales si nécessaire.<br><br>

<h5>4. Protection des informations</h5>
ASSHA-CMTF met en œuvre des mesures techniques et organisationnelles pour sécuriser vos données.<br><br>

<h5>5. Droits des utilisateurs</h5>
Droit d'accès, rectification, suppression, opposition et blocage des contacts.<br><br>

<h5>6. Règles de messagerie ASSHA-CMTF</h5>
Respect des conditions d'utilisation, interdiction de contenus illégaux ou protégés par droits d’auteur, cryptage des communications.<br><br>

<h5>7. Modifications de la Politique de confidentialité</h5>
Les modifications sont publiées sur cette page avec la date de mise à jour.<br><br>

<h5>8. Contact</h5>
Pour toute question :
<a href="mailto:assha-cmtf@gmail.com">assha-cmtf@gmail.com</a>
\`
  },

  en:{
    title:"Privacy policy",
    back:"Back",
    content:\`
<h5>GENERAL TERMS</h5>
Last updated: [June 28, 2025]<br><br>

<h5>1. Information Collection</h5>
ASSHA-CMTF collects identification info, profile info, shared content, and usage data.<br><br>

<h5>2. Use of Information</h5>
Information is used to provide services, manage accounts, communicate with users, and ensure security.<br><br>

<h5>3. Information Sharing</h5>
Data is only shared with service providers or legal authorities if required.<br><br>

<h5>4. Data Protection</h5>
ASSHA-CMTF implements technical and organizational security measures.<br><br>

<h5>5. User Rights</h5>
Access, rectification, deletion, objection, and blocking rights.<br><br>

<h5>6. Messaging Rules</h5>
Respect terms of use, prohibition of illegal or copyrighted content, encryption of communications.<br><br>

<h5>7. Privacy Policy Updates</h5>
Updates are posted on this page with the last update date.<br><br>

<h5>8. Contact</h5>
For questions:
<a href="mailto:assha-cmtf@gmail.com">assha-cmtf@gmail.com</a>
\`
  }
};

document.getElementById("headerTitle").textContent = texts[lang].title;
document.getElementById("pageTitle").textContent = texts[lang].title;
document.getElementById("backText").textContent = texts[lang].back;
document.getElementById("pageContent").innerHTML = texts[lang].content;
</script>

</body>
</html>`);
});





// -------------------- Démarrage serveur --------------------
app.listen(port, () => {
    console.log("Serveur lancé sur le port " + port);
});
