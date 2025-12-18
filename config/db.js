const mysql = require("mysql2");

//const db = mysql.createConnection({
    //host: "127.0.0.1",
   // user: "root",
   // password: "",
   // database: "monapp",
   // port: 3306
//});

//db.connect(err => {
    //if (err) {
       // console.error("❌ Erreur MySQL :", err);
   // } else {
        //console.log("✅ MySQL connecté (monapp)");
  //  }
//});

//module.exports = db;

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: 3306
});

db.connect(err => {
    if (err) {
        console.error("❌ Erreur MySQL :", err);
    } else {
        console.log("✅ MySQL connecté (monapp)");
    }
});

module.exports = db;
