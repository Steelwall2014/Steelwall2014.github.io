function loadImage(url) {
  console.log(`Downloading ${url}...`);
  window.counter();
  return new Promise((accept, error) => {
    const img = new Image();
    img.onload = () => {
      accept(img);
    };
    img.onerror = error;
    img.crossOrigin = "anonymous";
    img.src = url;
  });
}
function degrees(rad) {
  return 180 / Math.PI * rad
}
function radians(deg) {
  return Math.PI / 180 * deg
}
function long2tile(l, zoom) {
  return Math.floor(((l + 180) / 360) * Math.pow(2, zoom));
}

function lat2tile(l, zoom) {
  return Math.floor(
    ((1 -
      Math.log(
        Math.tan((l * Math.PI) / 180) + 1 / Math.cos((l * Math.PI) / 180)
      ) /
      Math.PI) /
      2) *
    Math.pow(2, zoom)
  );
}

function tile2long(x, z) {
  return (x / Math.pow(2, z)) * 360 - 180;
}
function tile2lat(y, zoom) {
  var n = Math.pow(2, zoom);
  var lat_rad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)))
  var lat_deg = degrees(lat_rad)
  return lat_deg
}
function PingPong(regl, opts) {
  const fbos = [regl.framebuffer(opts), regl.framebuffer(opts)];

  let index = 0;

  function ping() {
    return fbos[index];
  }

  function pong() {
    return fbos[1 - index];
  }

  function swap() {
    index = 1 - index;
  }

  return {
    ping,
    pong,
    swap
  };
}
async function getRegion_Whole(api) {
  var img = await loadImage(api);
  return img
}
async function getRegion(tLat, tLong, zoom, api) {
  const canvas = document.createElement("canvas");
  canvas.width = 3 * 256;
  canvas.height = 3 * 256;
  const ctx = canvas.getContext("2d");
  for (let x = 0; x < 3; x++) {
    const _tLong = tLong + (x - 1);
    for (let y = 0; y < 3; y++) {
      const _tLat = tLat + (y - 1);
      const url = api
        .replace("zoom", zoom)
        .replace("tLat", _tLat)
        .replace("tLong", _tLong);
      const img = await loadImage(url);
      ctx.drawImage(img, x * 256, y * 256);
    }
  }
  return canvas;
}
async function getRegion_Tiles(tLong0, tLat0, tLong1, tLat1, zoom, api) {
  const canvas = document.createElement("canvas");
  if (tLat0 < tLat1) {
    [tLat0, tLat1] = [tLat1, tLat0]
  }
  if (tLong0 > tLong1) {
    [tLong0, tLong1] = [tLong1, tLong0]
  }
  canvas.width = (tLong1 - tLong0 + 1) * 256;
  canvas.height = (tLat0 - tLat1 + 1) * 256;
  const ctx = canvas.getContext("2d");
  console.log("tLong0: ", tLong0, "tLong1: ", tLong1,
    "tLat1: ", tLat1, "tLat1: ", tLat0,
    "zoom: ", zoom,
    "tile number: ", (tLong1 - tLong0 + 1) * (tLat0 - tLat1 + 1))
  for (let _tLong = tLong0; _tLong <= tLong1; _tLong++) {
    for (let _tLat = tLat1; _tLat <= tLat0; _tLat++) {
      const url = api
        .replace("zoom", zoom)
        .replace("tLat", _tLat)
        .replace("tLong", _tLong);
      const img = await loadImage(url);
      ctx.drawImage(img, (_tLong - tLong0) * 256, (_tLat - tLat1) * 256);
    }
  }
  return canvas;
}
function saveStringToFile(filename, str) {

  // 创建一个 <a> 标签对象
  var linkTag = window.document.createElement("a");
  // 设置该实例的 download 和 href 属性(HTML 5 标准属性)
  linkTag.download = filename;
  linkTag.href = window.URL.createObjectURL(new Blob([str]));

  // 把刚才手动创建的 <a> 添加到 DOM 文档中
  window.document.body.appendChild(linkTag);
  linkTag.click();    // 调用点击事件
  // 移除刚才添加的子标签
  window.document.body.removeChild(linkTag);

}
function createImageFromTexture(gl, fbo, width, height) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  var data = new Float32Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, data);
  console.log(data)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  var data_uint = new Uint32Array(width * height * 4);
  for (let i = 0; i < data.length; i++) {
    /*if ((i + 1) % 4 == 0)
      data_uint[i] = 0
    else*/
      data_uint[i] = data[i] * 255
  }
  console.log(data_uint)
  
  // Create a 2D canvas to store the result 
  var canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  var context = canvas.getContext('2d', { preserveDrawingBuffer: true });

  // Copy the pixels to a 2D canvas
  var imageData = context.createImageData(width, height);
  imageData.data.set(data_uint);
  context.putImageData(imageData, 0, 0);
  var img = new Image();
  img.src = canvas.toDataURL();
  console.log(canvas.toDataURL())
  //return img;
  //var img = new Image();
  //img.src = canvas.toDataURL();
  img.addEventListener("load", function(){
    var download_link = document.createElement("a")
    var event = new MouseEvent('click')
    //console.log(document.getElementById("ScreenShot").src)
    download_link.download = "final_fbo"
    download_link.href = img.src;
    download_link.dispatchEvent(event)
  })

}

function genTerrain(img_width, img_height, dx, dy, xx, yy, segment_factor = 1) {
  //var w = img_width - 1, h = img_height - 1;
  img_width = Math.floor(img_width * segment_factor);
  img_height = Math.floor(img_height * segment_factor);
  dx = dx / segment_factor;
  dy = dy / segment_factor;
  var uvs = [], positions = [], indices = []
  for (let y = 0; y < img_height; y++) {
    for (let x = 0; x < img_width; x++) {
      var u = y / img_height, v = x / img_width;
      uvs.push(v, u);
      var pos_x = xx + x * dx, pos_y = yy + y * dy;
      positions.push(pos_x, pos_y, 0);
    }
  }

  for (let y = 1; y < img_height; y++) {
    for (let x = 1; x < img_width; x++) {
      var upper_right = x + y * img_width;
      var upper_left = (x - 1) + y * img_width;
      var lower_right = x + (y - 1) * img_width;
      var lower_left = (x - 1) + (y - 1) * img_width;
      indices.push(lower_left, upper_right, lower_right);
      indices.push(lower_left, upper_left, upper_right);
    }
  }
  //saveStringToFile("14.txt", [img_width, img_height, dx, dy, xx, yy])
  return { positions, uvs, indices }
}
export {
  loadImage,
  lat2tile,
  long2tile,
  tile2long,
  PingPong,
  getRegion,
  tile2lat,
  degrees,
  radians,
  genTerrain,
  getRegion_Whole,
  getRegion_Tiles,
  createImageFromTexture
};
