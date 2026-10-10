const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'riverride2.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function game() {
  const context2d = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}) });
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      width: 480, height: 360, style: {}, textContent: '',
      setAttribute() {}, getContext: () => context2d
    });
    return elements.get(id);
  };
  const math = Object.create(Math);
  math.random = () => 0.5;
  const context = vm.createContext({
    Math: math,
    document: { getElementById: element, querySelector: element },
    window: { addEventListener() {} },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}
  });
  vm.runInContext(script, context);
  const run = code => vm.runInContext(code, context);
  run('ships = []; fuels = []; ammoBoxes = []; bullets = [];');
  return run;
}

test('refuelling grows with contact time; leaving the depot stops it without consuming it', () => {
  const run = game();
  run(`fuel = 30; fuels = [{x: plane.x, y: plane.y - 20, w: 24, h: 40, hp: 2, hitFlash: 0}];`);
  run('update(0)');
  assert.equal(run('fuel'), 30);
  run('for (let i = 0; i < 10; i++) update(BASE_FRAME_MS);');
  assert.ok(Math.abs(run('fuel') - 32.44) < 1e-8);
  assert.equal(run('fuels.length'), 1);
  assert.equal(run('fuels[0].hp'), 2);
  run('plane.x += 60; update(BASE_FRAME_MS);');
  assert.ok(Math.abs(run('fuel') - 32.434) < 1e-8);
  assert.equal(run('fuels.length'), 1);
});

function flyOver(key, fps) {
  const run = game();
  run(`fuel = 20; keys.add(${JSON.stringify(key)});
    fuels = [{x: plane.x, y: plane.y - 40, w: 24, h: 40, hp: 2, hitFlash: 0}];`);
  run(`while (fuels[0].y < plane.y + plane.h + 1 && !gameOver) update(1000 / ${fps});`);
  assert.equal(run('gameOver'), false);
  assert.equal(run('fuels.length'), 1);
  return run('fuel');
}

test('slowing down gives more fuel; refuelling rate is independent of frame rate', () => {
  const slow = flyOver('ArrowDown', 60);
  const normal = flyOver('', 60);
  const fast = flyOver('ArrowUp', 60);
  assert.ok(slow > normal && normal > fast && fast > 20);
  assert.ok(Math.abs(flyOver('ArrowDown', 30) - flyOver('ArrowDown', 144)) < 0.6);
});

test('a partially used fuel depot can still be shot twice for 75 points', () => {
  const run = game();
  run(`fuel = 30; fuels = [{x: plane.x, y: plane.y - 30, w: 24, h: 40, hp: 2, hitFlash: 0}];
    for (let i = 0; i < 5; i++) update(BASE_FRAME_MS);
    shoot(); update(BASE_FRAME_MS);`);
  assert.ok(run('fuel') > 30);
  assert.equal(run('fuels[0].hp'), 1);
  run('for (let i = 0; i < 10; i++) update(BASE_FRAME_MS); shoot(); update(BASE_FRAME_MS);');
  assert.equal(run('fuels.length'), 0);
  assert.equal(run('ammo'), 198);
  assert.equal(run('Math.floor(score)'), 75);
  const fuelAfterDestruction = run('fuel');
  run('update(BASE_FRAME_MS);');
  assert.ok(run('fuel') < fuelAfterDestruction);
});

test('fuel caps at 100 and overlapping depots do not multiply refuelling', () => {
  const run = game();
  run(`fuel = 50;
    fuels = Array.from({length: 2}, () => ({x: plane.x, y: plane.y, w: 24, h: 40, hp: 2, hitFlash: 0}));
    update(BASE_FRAME_MS);`);
  assert.ok(Math.abs(run('fuel') - 50.244) < 1e-8);
  run('fuel = 99.99; update(BASE_FRAME_MS);');
  assert.equal(run('fuel'), 100);
  assert.equal(run('fuels.length'), 2);
});

test('contact can replenish the last drop; an empty tank away from a depot ends the flight', () => {
  const run = game();
  run(`fuel = 0.001; fuels = [{x: plane.x, y: plane.y, w: 24, h: 40, hp: 2, hitFlash: 0}]; update(BASE_FRAME_MS);`);
  assert.equal(run('gameOver'), false);
  assert.ok(run('fuel') > 0);
  run('fuels = []; fuel = 0.001; update(BASE_FRAME_MS);');
  assert.equal(run('fuel'), 0);
  assert.equal(run('gameOverMessage'), 'Zabrakło paliwa');
});

test('normal bends have parallel banks, with distinct narrow and wide sections', () => {
  const run = game();
  for (const distance of [0, 200, 300, 400, 600, 700, 2000, 2300, 2400]) {
    assert.equal(run(`worldDistance = ${distance}; riverBounds(0).right - riverBounds(0).left`), 280);
  }
  assert.equal(run('worldDistance = 960; riverBounds(0).right - riverBounds(0).left'), 192);
  assert.equal(run('worldDistance = 1320; riverBounds(0).right - riverBounds(0).left'), 360);
  assert.equal(run('worldDistance = 2720; riverBounds(0).right - riverBounds(0).left'), 344);
});

test('the river forks into two navigable channels and merges again; the island is solid', () => {
  const run = game();
  for (const [distance, expected] of [[1360, 1], [1520, 2], [1660, 2], [1820, 1]]) {
    assert.equal(run(`worldDistance = ${distance}; riverChannels(0).length`), expected);
  }
  run('worldDistance = 1600 + plane.y;');
  for (const x of [110, 320]) {
    assert.equal(run(`plane.x = ${x}; isOverWater(plane)`), true);
  }
  assert.equal(run('plane.x = 228; isOverWater(plane)'), false);
  run('update(0)');
  assert.equal(run('gameOverMessage'), 'Uderzenie w brzeg');
});

test('spawned objects fit on water through bends, necks and both sides of islands', () => {
  const run = game();
  assert.equal(run(`(() => {
    for (let distance = 0; distance < 3160; distance += 16) {
      worldDistance = distance;
      for (const random of [0.0001, 0.9999]) {
        Math.random = () => random;
        ships = []; fuels = []; ammoBoxes = [];
        spawnShip(-30); spawnFuel(-40); spawnAmmo(-35);
        if (ships.length !== 1 || fuels.length !== 1 || ammoBoxes.length !== 1) return false;
        for (const object of [...ships, ...fuels, ...ammoBoxes]) {
          const rect = {...object, w: object.w ?? 24, h: object.h ?? 24};
          if (!isOverWater(rect)) return false;
          // The object keeps its channel as it travels down the screen.
          worldDistance += 317.5; rect.y += 317.5;
          if (!isOverWater(rect)) return false;
          worldDistance -= 317.5;
        }
      }
    }
    return true;
  })()`), true);
});

test('river geometry scrolls with the objects and joins seamlessly across course repetitions', () => {
  const run = game();
  const before = run('worldDistance = 1612; JSON.stringify(riverChannels(100))');
  const after = run('worldDistance += 17.25; JSON.stringify(riverChannels(117.25))');
  assert.equal(before, after);
  assert.equal(run('worldDistance = 3159; JSON.stringify(riverChannels(0))'),
    run('worldDistance = 3161; JSON.stringify(riverChannels(0))'));
});

test('bullets cannot fly through the island', () => {
  const run = game();
  run(`worldDistance = 1700; plane.x = 110;
    bullets = [{x: 238, y: 100, w: 4, h: 12, speed: 3.5}]; update(0);`);
  assert.equal(run('bullets.length'), 0);
  assert.equal(run('gameOver'), false);
});

test('a crash freezes gameplay while its animation continues, then ends', () => {
  const run = game();
  run('plane.x = 0; update(BASE_FRAME_MS);');
  assert.equal(run('gameOver'), true);
  assert.ok(run('crash.pixels.length') > 0);
  const frozen = run('JSON.stringify({x:plane.x,worldDistance,fuel,ammo,score,ships,fuels,bullets})');
  run(`keys.add('ArrowRight'); keys.add(' '); shoot(); update(300);`);
  assert.equal(run('crash.elapsed'), 300);
  assert.equal(run('JSON.stringify({x:plane.x,worldDistance,fuel,ammo,score,ships,fuels,bullets})'), frozen);
  run(`endGame('Another impact');`);
  assert.equal(run('crash.elapsed'), 300);
  assert.equal(run('gameOverMessage'), 'Uderzenie w brzeg');
  run('update(600);');
  assert.equal(run('crash'), null);
  assert.equal(run('gameOver'), true);
});

test('the plane is replaced by debris and the end message waits for the animation', () => {
  const run = game();
  run(`let drawn = [];
    drawPlane = () => drawn.push('plane');
    drawCrash = () => drawn.push('debris');
    drawGameOver = () => drawn.push('message');
    draw();`);
  assert.equal(run('drawn.join()'), 'plane');
  run(`endGame('Zderzenie z okrętem'); drawn=[]; draw();`);
  assert.equal(run('drawn.join()'), 'debris');
  run('update(CRASH_DURATION_MS); drawn=[]; draw();');
  assert.equal(run('drawn.join()'), 'message');
  run('startGame(); drawn=[]; draw();');
  assert.equal(run('drawn.join()'), 'plane');
  assert.equal(run('crash'), null);
});

test('the animation loop remains scheduled until the debris has disappeared', () => {
  const run = game();
  run(`let scheduled = 0; requestAnimationFrame = () => ++scheduled;
    plane.x = 0; loop(BASE_FRAME_MS);`);
  assert.equal(run('scheduled'), 1);
  run('loop(BASE_FRAME_MS * 2);');
  assert.equal(run('scheduled'), 2);
  run('update(CRASH_DURATION_MS); loop(BASE_FRAME_MS * 3);');
  assert.equal(run('scheduled'), 2);
});

test('only a destroyed ship produces a short effect, while the flight continues', () => {
  const run = game();
  run(`ships = [{x: 220, y: 100, w: 48, h: 18, hp: 2, hitFlash: 0}];
    bullets = [{x: 230, y: 106, w: 4, h: 12, speed: 3.5}]; update(0);`);
  assert.equal(run('ships[0].hp'), 1);
  assert.equal(run('shipExplosions.length'), 0);
  run('bullets = [{x: 230, y: 106, w: 4, h: 12, speed: 3.5}]; update(0);');
  assert.equal(run('ships.length'), 0);
  assert.equal(run('score'), 100);
  assert.equal(run('shipExplosions.length'), 1);
  assert.equal(run('gameOver'), false);
  assert.equal(run('crash'), null);
  const y = run('shipExplosions[0].y');
  run('update(100);');
  assert.ok(run('shipExplosions[0].y') > y);
  assert.equal(run('shipExplosions[0].elapsed'), 100);
  run('update(460);');
  assert.equal(run('shipExplosions.length'), 0);
  assert.equal(run('gameOver'), false);
  run('shipExplosions.push({x: 240, y: 110, elapsed: 0}); startGame();');
  assert.equal(run('shipExplosions.length'), 0);
});
