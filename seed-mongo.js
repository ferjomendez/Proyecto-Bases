// =============================================
// Puebla MongoDB con 1000+ documentos en historial_consultas
// Cumple: "todas las bases de datos deben tener una tabla/coleccion
// con al menos 1000 registros".
// Ejecutar: npm run seed:mongo
// =============================================
require('dotenv').config();
const dns = require('dns');
// El resolvedor DNS por defecto de Node (c-ares) en Windows a veces rechaza
// las consultas SRV de mongodb+srv:// aunque el DNS del sistema si las resuelva.
// Forzamos un DNS publico para evitar el error querySrv ECONNREFUSED.
dns.setServers(['8.8.8.8', '1.1.1.1']);
const { MongoClient } = require('mongodb');

const N_DOCS = 1200; // > 1000 con margen

const rnd = (min, max) => Math.random() * (max - min) + min;
const rndInt = (min, max) => Math.floor(rnd(min, max + 1));
const pick = (arr) => arr[rndInt(0, arr.length - 1)];

// Ejemplos realistas de consultas que el sistema registra
const ejemplos = {
  predefinida: [
    'SELECT e.nombre AS empresa, SUM(ce.emision_total) FROM empresa e JOIN consumo c ... GROUP BY e.id_empresa',
    'SELECT s.nombre AS sector, SUM(ce.emision_total) FROM sector s ... GROUP BY s.id_sector',
    'SELECT fe.scope, SUM(ce.emision_total) FROM fuente_emision fe ... GROUP BY fe.scope',
    'SELECT e.nombre, fe.nombre, c.cantidad FROM consumo c ... ORDER BY c.fecha_registro DESC LIMIT 20',
    'SELECT p.nombre AS pais, COUNT(e.id_empresa) FROM pais p ... GROUP BY p.id_pais',
    'SELECT nombre, factor_emision, unidad FROM fuente_emision ORDER BY scope, nombre'
  ],
  libre: [
    'SELECT * FROM empresa LIMIT 10;',
    'SELECT COUNT(*) FROM consumo;',
    'SELECT * FROM calculo_emision ORDER BY emision_total DESC LIMIT 5;',
    'SELECT tamano, COUNT(*) FROM empresa GROUP BY tamano;',
    'SHOW TABLES;',
    'DESCRIBE consumo;'
  ],
  insercion: [
    'INSERT INTO empresa (nombre, tamano, id_sector, id_pais) VALUES (?, ?, ?, ?)',
    'INSERT INTO consumo (...) VALUES (...) + calculo_emision'
  ]
};

async function seedMongo() {
  if (!process.env.MONGODB_URI) {
    throw new Error('Falta MONGODB_URI en .env');
  }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  console.log('Conectado a MongoDB Atlas.');

  const db = client.db('huella_carbono_logs');
  const col = db.collection('historial_consultas');

  // Limpiar para que el seed sea re-ejecutable
  await col.deleteMany({});
  console.log('Coleccion historial_consultas limpiada.');

  const tipos = ['predefinida', 'libre', 'insercion'];
  const docs = [];
  const ahora = Date.now();
  const unDiaMs = 24 * 60 * 60 * 1000;

  for (let i = 0; i < N_DOCS; i++) {
    const tipo = pick(tipos);
    const huboError = Math.random() < 0.05; // 5% de consultas con error
    docs.push({
      tipo,
      consulta: pick(ejemplos[tipo]),
      resultados: huboError ? null : (tipo === 'insercion' ? 1 : rndInt(0, 1000)),
      error: huboError ? 'Ejemplo de error simulado' : null,
      // fechas repartidas en los ultimos 90 dias
      fecha: new Date(ahora - rndInt(0, 90) * unDiaMs - rndInt(0, unDiaMs)),
      usuario: 'web'
    });
  }

  await col.insertMany(docs);

  const total = await col.countDocuments();
  console.log(`Documentos insertados. TOTAL en historial_consultas: ${total}`);
  console.log(total >= 1000 ? '  >> Cumple el requisito de 1000+ registros en MongoDB.' : '  >> ATENCION: por debajo de 1000.');

  await client.close();
  console.log('Seed de MongoDB completado!');
}

seedMongo().catch(err => {
  console.error('Error en seed-mongo:', err.message);
  process.exit(1);
});
