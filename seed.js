// =============================================
// Script para crear tablas e insertar datos de ejemplo
// Genera ~2222 filas en total (1000 en la tabla consumo) - entrega TICS320
// Ejecutar: npm run seed
// =============================================
require('dotenv').config();
const mysql = require('mysql2/promise');

// --- Parametros de volumen ---
const N_EMPRESAS = 200;
const N_CONSUMOS = 1000;
// Catalogo: 6 sectores + 6 paises + 10 fuentes = 22
// Total aprox: 22 + 200 + 1000 + 1000 (calculos) = 2222 filas

const rnd = (min, max) => Math.random() * (max - min) + min;
const rndInt = (min, max) => Math.floor(rnd(min, max + 1));
const pick = (arr) => arr[rndInt(0, arr.length - 1)];

async function seed() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    ssl: process.env.MYSQL_SSL === 'true' ? { rejectUnauthorized: false } : false,
    multipleStatements: true
  });

  console.log('Conectado a MySQL. Recreando tablas e insertando datos...\n');

  // Borrar tablas en orden inverso de dependencias (seed re-ejecutable)
  await connection.query(`
    SET FOREIGN_KEY_CHECKS = 0;
    DROP TABLE IF EXISTS calculo_emision;
    DROP TABLE IF EXISTS consumo;
    DROP TABLE IF EXISTS empresa;
    DROP TABLE IF EXISTS fuente_emision;
    DROP TABLE IF EXISTS pais;
    DROP TABLE IF EXISTS sector;
    SET FOREIGN_KEY_CHECKS = 1;
  `);

  // Crear tablas
  await connection.query(`
    CREATE TABLE sector (
      id_sector   INT AUTO_INCREMENT,
      nombre      VARCHAR(100) NOT NULL,
      descripcion VARCHAR(255) NULL,
      PRIMARY KEY (id_sector)
    ) ENGINE=InnoDB;

    CREATE TABLE pais (
      id_pais     INT AUTO_INCREMENT,
      nombre      VARCHAR(100) NOT NULL,
      codigo_iso  CHAR(3) NOT NULL,
      PRIMARY KEY (id_pais),
      UNIQUE (codigo_iso)
    ) ENGINE=InnoDB;

    CREATE TABLE empresa (
      id_empresa  INT AUTO_INCREMENT,
      nombre      VARCHAR(150) NOT NULL,
      tamano      ENUM('micro', 'pequena', 'mediana', 'grande') NOT NULL,
      id_sector   INT NOT NULL,
      id_pais     INT NOT NULL,
      PRIMARY KEY (id_empresa),
      CONSTRAINT fk_empresa_sector FOREIGN KEY (id_sector) REFERENCES sector(id_sector) ON UPDATE CASCADE ON DELETE RESTRICT,
      CONSTRAINT fk_empresa_pais FOREIGN KEY (id_pais) REFERENCES pais(id_pais) ON UPDATE CASCADE ON DELETE RESTRICT
    ) ENGINE=InnoDB;

    CREATE TABLE fuente_emision (
      id_fuente       INT AUTO_INCREMENT,
      nombre          VARCHAR(100) NOT NULL,
      factor_emision  DECIMAL(12,6) NOT NULL COMMENT 'kg CO2 eq por unidad',
      scope           TINYINT NOT NULL COMMENT '1=directas, 2=indirectas energia, 3=otras indirectas',
      unidad          VARCHAR(50) NOT NULL COMMENT 'Ej: kWh, litros, kg, km',
      PRIMARY KEY (id_fuente),
      CHECK (scope IN (1, 2, 3))
    ) ENGINE=InnoDB;

    CREATE TABLE consumo (
      id_consumo      INT AUTO_INCREMENT,
      id_empresa      INT NOT NULL,
      id_fuente       INT NOT NULL,
      cantidad        DECIMAL(14,4) NOT NULL,
      periodo         ENUM('mensual', 'trimestral', 'anual') NOT NULL,
      fecha_registro  DATE NOT NULL,
      PRIMARY KEY (id_consumo),
      CONSTRAINT fk_consumo_empresa FOREIGN KEY (id_empresa) REFERENCES empresa(id_empresa) ON UPDATE CASCADE ON DELETE RESTRICT,
      CONSTRAINT fk_consumo_fuente FOREIGN KEY (id_fuente) REFERENCES fuente_emision(id_fuente) ON UPDATE CASCADE ON DELETE RESTRICT,
      INDEX idx_consumo_empresa (id_empresa),
      INDEX idx_consumo_fecha (fecha_registro)
    ) ENGINE=InnoDB;

    CREATE TABLE calculo_emision (
      id_calculo      INT AUTO_INCREMENT,
      id_consumo      INT NOT NULL,
      emision_total   DECIMAL(14,6) NOT NULL COMMENT 'En kg CO2 equivalente',
      fecha_calculo   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id_calculo),
      CONSTRAINT fk_calculo_consumo FOREIGN KEY (id_consumo) REFERENCES consumo(id_consumo) ON UPDATE CASCADE ON DELETE CASCADE,
      UNIQUE (id_consumo)
    ) ENGINE=InnoDB;
  `);
  console.log('Tablas creadas.\n');

  // ---------- Catalogos ----------
  const sectores = [
    ['Energia', 'Generacion y distribucion de energia electrica'],
    ['Transporte', 'Transporte terrestre, aereo y maritimo'],
    ['Manufactura', 'Industria manufacturera y produccion'],
    ['Agricultura', 'Actividades agricolas y ganaderas'],
    ['Construccion', 'Construccion e infraestructura'],
    ['Mineria', 'Extraccion de minerales y recursos']
  ];
  await connection.query('INSERT INTO sector (nombre, descripcion) VALUES ?', [sectores]);

  const paises = [
    ['Chile', 'CHL'], ['Argentina', 'ARG'], ['Brasil', 'BRA'],
    ['Colombia', 'COL'], ['Mexico', 'MEX'], ['Peru', 'PER']
  ];
  await connection.query('INSERT INTO pais (nombre, codigo_iso) VALUES ?', [paises]);

  const fuentes = [
    ['Diesel (vehiculos)', 2.680000, 1, 'litros'],
    ['Gas natural', 2.020000, 1, 'metros cubicos'],
    ['Gasolina', 2.310000, 1, 'litros'],
    ['Electricidad (red Chile)', 0.390000, 2, 'kWh'],
    ['Electricidad (red Argentina)', 0.350000, 2, 'kWh'],
    ['Electricidad (red Brasil)', 0.080000, 2, 'kWh'],
    ['Vuelos domesticos', 0.255000, 3, 'km-pasajero'],
    ['Transporte carga terrestre', 0.105000, 3, 'ton-km'],
    ['Residuos solidos', 0.450000, 1, 'kg'],
    ['Agua potable', 0.344000, 3, 'metros cubicos']
  ];
  await connection.query('INSERT INTO fuente_emision (nombre, factor_emision, scope, unidad) VALUES ?', [fuentes]);

  // ---------- Empresas (generadas) ----------
  const prefijos = ['Eco', 'Verde', 'Sustenta', 'Andina', 'Global', 'Pacifico', 'Norte', 'Sur',
    'Industrias', 'Grupo', 'Corp', 'Energia', 'Logistica', 'Agro', 'Mineria', 'Construye'];
  const sufijos = ['SA', 'Ltda', 'SpA', 'Holding', 'Group', 'Solutions', 'Partners', 'Co'];
  const tamanos = ['micro', 'pequena', 'mediana', 'grande'];

  const empresasRows = [];
  for (let i = 1; i <= N_EMPRESAS; i++) {
    const nombre = `${pick(prefijos)} ${pick(sufijos)} ${i}`;
    empresasRows.push([nombre, pick(tamanos), rndInt(1, sectores.length), rndInt(1, paises.length)]);
  }
  await connection.query('INSERT INTO empresa (nombre, tamano, id_sector, id_pais) VALUES ?', [empresasRows]);

  // ---------- Consumos + Calculos ----------
  const periodos = ['mensual', 'trimestral', 'anual'];
  const consumosRows = [];
  const emisiones = [];

  for (let i = 0; i < N_CONSUMOS; i++) {
    const idEmpresa = rndInt(1, N_EMPRESAS);
    const idFuente = rndInt(1, fuentes.length);
    const factor = fuentes[idFuente - 1][1];
    const cantidad = parseFloat(rnd(100, 1000000).toFixed(4));
    const periodo = pick(periodos);
    const mes = String(rndInt(1, 12)).padStart(2, '0');
    const dia = String(rndInt(1, 28)).padStart(2, '0');
    const fecha = `2025-${mes}-${dia}`;
    consumosRows.push([idEmpresa, idFuente, cantidad, periodo, fecha]);
    emisiones.push(parseFloat((cantidad * factor).toFixed(6)));
  }
  const [resConsumo] = await connection.query(
    'INSERT INTO consumo (id_empresa, id_fuente, cantidad, periodo, fecha_registro) VALUES ?',
    [consumosRows]
  );

  const baseId = resConsumo.insertId;
  const calculosRows = emisiones.map((em, idx) => [baseId + idx, em]);
  await connection.query('INSERT INTO calculo_emision (id_consumo, emision_total) VALUES ?', [calculosRows]);

  // ---------- Conteos ----------
  const tablas = ['sector', 'pais', 'fuente_emision', 'empresa', 'consumo', 'calculo_emision'];
  let total = 0;
  console.log('Datos insertados:');
  for (const t of tablas) {
    const [r] = await connection.query(`SELECT COUNT(*) AS c FROM \`${t}\``);
    console.log(`  - ${t}: ${r[0].c}`);
    total += r[0].c;
  }
  console.log(`\n  TOTAL DE FILAS: ${total}`);
  console.log(total >= 1000 ? '  >> Cumple el requisito de 1000+ datos.' : '  >> ATENCION: por debajo de 1000.');
  console.log('\nSeed completado!');

  await connection.end();
}

seed().catch(err => {
  console.error('Error en seed:', err.message);
  process.exit(1);
});
