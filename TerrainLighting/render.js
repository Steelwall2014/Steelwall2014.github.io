"use strict";
//const mapboxgljs = document.createElement('script');
//mapboxgljs.setAttribute('src', 'node_modules/mapbox-gl/dist/mapbox-gl.js');
//document.head.appendChild(mapboxgljs);
import { loadImage, lat2tile, long2tile, tile2long, getRegion, tile2lat, degrees, radians, genTerrain, createImageFromTexture } from "./utils.js"
import { vec3 } from "./gl-matrix/index.js";

/*
 * TEXTURE0     高程rgb和卫星图
 * TEXTURE1     高程灰度
 * TEXTURE2     法线
 * TEXTURE3、4  soft shadow
 * TEXTURE5、6  ambient
 * TEXTURE7     final
*/

const sunRadiusScale = 1
var sunPos = [0.5, -1, 0.4];
var softShadowScale = 3.0;
var ambientScale = 0.25
var elevationScale = 2.0
window.elevationScale = elevationScale

var zoom;
var lower_left = [0, 0];
var upper_right = [0, 0];
var tlong0, tlong1, tlat0, tlat1;
var center;
var radius;
var pixelScale;

function createProgram(gl, [vertexShaderSource, fragShaderSource]) {
    var vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, vertexShaderSource);
    gl.compileShader(vertexShader)

    var fragShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragShader, fragShaderSource);
    gl.compileShader(fragShader);

    var program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragShader);

    gl.linkProgram(program);

    return program;
}
function initFramebuffer(gl, texture_id) {
    var out_fbo = gl.createFramebuffer();
    var out_texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + texture_id)                   // 这边一定要active，如果不这样那么就把0号纹理覆盖了
    gl.bindTexture(gl.TEXTURE_2D, out_texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, window.img_width, window.img_height, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    out_fbo.texture = out_texture


    gl.bindFramebuffer(gl.FRAMEBUFFER, out_fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out_texture, 0)
    var e = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (gl.FRAMEBUFFER_COMPLETE !== e) {
        console.log('Frame buffer object is incomplete: ' + e.toString());
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return out_fbo
}
function PingPong(gl, texture_id1, texture_id2) {
    const ids = [texture_id1, texture_id2];
    const fbos = [initFramebuffer(gl, texture_id1), initFramebuffer(gl, texture_id2)]
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

    function getPingId() {
        return ids[index];
    }

    return {
        ping,
        pong,
        swap,
        getPingId
    };
}
function processTerrain(gl, terrain_img) {
    var terrain_vert_source = `
    precision highp float;
    attribute vec2 position;
    attribute vec2 a_text_coord;

    varying vec2 v_text_coord;
    void main() {
        gl_Position = vec4(position, 0, 1);
        v_text_coord = a_text_coord;
    }`
    var terrain_frag_source = `
    precision highp float;

    uniform sampler2D tElevation;
    //uniform vec2 resolution;
    uniform float elevationScale;

    varying vec2 v_text_coord;
    void main() {
    vec3 rgb = texture2D(tElevation, v_text_coord).rgb;
    float e = -10000.0 + (rgb.r * 255.0 * 256.0 * 256.0 + rgb.g * 255.0 * 256.0 + rgb.b * 255.0) * 0.1;
    gl_FragColor = vec4(vec3(e * elevationScale), 1.0);
    //gl_FragColor = vec4(vec3(e), 1.0);
    //gl_FragColor = vec4(1.4, 0.0, 0.0, 1.0);
    }`
    var terrain_program = createProgram(gl, [terrain_vert_source, terrain_frag_source])
    gl.useProgram(terrain_program)

    {   // 绑定buffer
        var position = new Float32Array([
            -1, -1,
            1, -1,
            1, 1,

            -1, -1,
            1, 1,
            -1, 1])
        var posBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, position, gl.STATIC_DRAW);
        var textCoord = new Float32Array([
            0, 0,
            1, 0,
            1, 1,

            0, 0,
            1, 1,
            0, 1])
        var textureCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, textCoord, gl.STATIC_DRAW);
    }

    {   // 设定纹理
        var texture = gl.createTexture();
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, terrain_img);
    }
    {   // 绑定变量
        var elevation_loc = gl.getUniformLocation(terrain_program, 'tElevation');
        var scale_loc = gl.getUniformLocation(terrain_program, "elevationScale");
        var position_loc = gl.getAttribLocation(terrain_program, "position");
        var textureCoord_loc = gl.getAttribLocation(terrain_program, "a_text_coord");

        gl.uniform1i(elevation_loc, 0);
        gl.uniform1f(scale_loc, elevationScale)

        gl.enableVertexAttribArray(position_loc);
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer)
        gl.vertexAttribPointer(position_loc, 2, gl.FLOAT, false, 0, 0);

        gl.enableVertexAttribArray(textureCoord_loc);
        gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer)
        gl.vertexAttribPointer(textureCoord_loc, 2, gl.FLOAT, false, 0, 0);

    }


    {
        var terrain_fbo = initFramebuffer(gl, 1);

        gl.bindFramebuffer(gl.FRAMEBUFFER, terrain_fbo);
        gl.drawArrays(gl.TRIANGLES, 0, 3 * 2);
        return terrain_fbo;
    }
}

function processNormal(gl, terrain_fbo) {
    var normal_vert_source = `
    precision highp float;
    attribute vec2 position;

    void main() {
      gl_Position = vec4(position, 0, 1);
    }
    `
    var normal_frag_source = `
    precision highp float;

    uniform sampler2D tElevation;
    uniform vec2 resolution;
    uniform float pixelScale;

    void main() {
      vec2 dr = 1.0/resolution;
      float p0 = texture2D(tElevation, dr * (gl_FragCoord.xy + vec2(0.0, 0.0))).r;
      float px = texture2D(tElevation, dr * (gl_FragCoord.xy + vec2(1.0, 0.0))).r;
      float py = texture2D(tElevation, dr * (gl_FragCoord.xy + vec2(0.0, 1.0))).r;
      vec3 dx = vec3(pixelScale, 0.0, px - p0);
      vec3 dy = vec3(0.0, pixelScale, py - p0);
      vec3 n = normalize(cross(dx, dy));
      gl_FragColor = vec4(n, 1.0);
      //gl_FragColor = texture2D(tElevation, gl_FragCoord.xy / resolution);
    }
    `
    var normalShader = createProgram(gl, [normal_vert_source, normal_frag_source]);
    gl.useProgram(normalShader)
    {
        var position = new Float32Array([
            -1, -1,
            1, -1,
            1, 1,

            -1, -1,
            1, 1,
            -1, 1])
        var posBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, position, gl.STATIC_DRAW)

    }


    var elevation_loc = gl.getUniformLocation(normalShader, "tElevation")
    var resolution_loc = gl.getUniformLocation(normalShader, "resolution")
    var pixelScale_loc = gl.getUniformLocation(normalShader, "pixelScale");
    var position_loc = gl.getAttribLocation(normalShader, "position");

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, terrain_fbo.texture)
    gl.uniform1i(elevation_loc, 1);
    gl.uniform2fv(resolution_loc, window.resolution);
    gl.uniform1f(pixelScale_loc, pixelScale)

    gl.enableVertexAttribArray(position_loc);
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.vertexAttribPointer(position_loc, 2, gl.FLOAT, false, 0, 0)

    var normal_fbo = initFramebuffer(gl, 2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, normal_fbo);
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    return normal_fbo
}

function processSoftShadow(softshadowShader, gl, sunDirection, src_id, tSrc, dest, terrain_fbo, normal_fbo) {

    gl.useProgram(softshadowShader)
    {
        var position = new Float32Array([
            -1, -1,
            1, -1,
            1, 1,

            -1, -1,
            1, 1,
            -1, 1])
        var posBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, position, gl.STATIC_DRAW)

    }


    var elevation_loc = gl.getUniformLocation(softshadowShader, "tElevation")
    var normal_loc = gl.getUniformLocation(softshadowShader, "tNormal")
    var tSrc_loc = gl.getUniformLocation(softshadowShader, "tSrc")
    var sunDirection_loc = gl.getUniformLocation(softshadowShader, "sunDirection")
    var resolution_loc = gl.getUniformLocation(softshadowShader, "resolution")
    var pixelScale_loc = gl.getUniformLocation(softshadowShader, "pixelScale");
    var position_loc = gl.getAttribLocation(softshadowShader, "position");


    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, terrain_fbo.texture)
    gl.uniform1i(elevation_loc, 0);

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, normal_fbo.texture)
    gl.uniform1i(normal_loc, 1)

    gl.activeTexture(gl.TEXTURE0 + src_id)
    gl.bindTexture(gl.TEXTURE_2D, tSrc.texture)
    gl.uniform1i(tSrc_loc, src_id);

    gl.uniform3fv(sunDirection_loc, sunDirection);
    gl.uniform2fv(resolution_loc, window.resolution);
    gl.uniform1f(pixelScale_loc, pixelScale)

    gl.enableVertexAttribArray(position_loc);
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.vertexAttribPointer(position_loc, 2, gl.FLOAT, false, 0, 0)

    gl.bindFramebuffer(gl.FRAMEBUFFER, dest);
    gl.drawArrays(gl.TRIANGLES, 0, 6)
}

function processAmbient(ambientShader, gl, direction, src_id, tSrc, dest, terrain_fbo, normal_fbo) {

    gl.useProgram(ambientShader)
    {
        var position = new Float32Array([
            -1, -1,
            1, -1,
            1, 1,

            -1, -1,
            1, 1,
            -1, 1])
        var posBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, position, gl.STATIC_DRAW)

    }


    var elevation_loc = gl.getUniformLocation(ambientShader, "tElevation")
    var normal_loc = gl.getUniformLocation(ambientShader, "tNormal")
    var tSrc_loc = gl.getUniformLocation(ambientShader, "tSrc")
    var direction_loc = gl.getUniformLocation(ambientShader, "direction")
    var resolution_loc = gl.getUniformLocation(ambientShader, "resolution")
    var pixelScale_loc = gl.getUniformLocation(ambientShader, "pixelScale");
    var position_loc = gl.getAttribLocation(ambientShader, "position");


    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, terrain_fbo.texture)
    gl.uniform1i(elevation_loc, 0);

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, normal_fbo.texture)
    gl.uniform1i(normal_loc, 1)

    gl.activeTexture(gl.TEXTURE0 + src_id)
    gl.bindTexture(gl.TEXTURE_2D, tSrc.texture)
    gl.uniform1i(tSrc_loc, src_id);

    gl.uniform3fv(direction_loc, direction);
    gl.uniform2fv(resolution_loc, window.resolution);
    gl.uniform1f(pixelScale_loc, pixelScale)

    gl.enableVertexAttribArray(position_loc);
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.vertexAttribPointer(position_loc, 2, gl.FLOAT, false, 0, 0)

    gl.bindFramebuffer(gl.FRAMEBUFFER, dest);
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    //checkFrameBufferData(gl)
    //gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function processSatellite(gl, satellite_img, softshadow_fbo, ambient_fbo) {
    var satellite_vert_source = `
    precision highp float;
    attribute vec2 position;

    void main() {
      gl_Position = vec4(position, 0, 1);
    }
    `
    var satellite_frag_source = `
    precision highp float;

    uniform sampler2D tSoftShadow;
    uniform sampler2D tAmbient;
    uniform sampler2D tSatellite;
    uniform vec2 resolution;

    uniform float softShadowScale;
    uniform float ambientScale;

    void main() {
      vec2 ires = 1.0 / resolution;
      float softShadow = texture2D(tSoftShadow, ires * gl_FragCoord.xy).r;
      float ambient = texture2D(tAmbient, ires * gl_FragCoord.xy).r;
      vec3 satellite = texture2D(tSatellite, ires * gl_FragCoord.xy).rgb;
      float l = softShadowScale * softShadow + ambientScale * ambient;
      vec3 color = l * pow(satellite, vec3(2.0));
      color = pow(color, vec3(1.0/2.2));
      gl_FragColor = vec4(color, 1.0);
      //gl_FragColor = vec4(0, 0, 0, 1.0);
    }
    `
    var satellite_program = createProgram(gl, [satellite_vert_source, satellite_frag_source])
    gl.useProgram(satellite_program)

    {   // 绑定buffer
        var position = new Float32Array([
            -1, -1,
            1, -1,
            1, 1,

            -1, -1,
            1, 1,
            -1, 1])
        var posBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, position, gl.STATIC_DRAW);
    }

    {   // 设定纹理
        var texture = gl.createTexture();
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, satellite_img);
    }
    {   // 绑定变量
        var tSoftShadow_loc = gl.getUniformLocation(satellite_program, 'tSoftShadow');
        var tAmbient_loc = gl.getUniformLocation(satellite_program, "tAmbient");
        var tSatellite_loc = gl.getUniformLocation(satellite_program, "tSatellite");
        var resolution_loc = gl.getUniformLocation(satellite_program, "resolution");
        var softShadowScale_loc = gl.getUniformLocation(satellite_program, "softShadowScale");
        var ambientScale_loc = gl.getUniformLocation(satellite_program, "ambientScale");


        var position_loc = gl.getAttribLocation(satellite_program, "position");

        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, softshadow_fbo.texture);
        gl.uniform1i(tSoftShadow_loc, 1);

        gl.activeTexture(gl.TEXTURE2)
        gl.bindTexture(gl.TEXTURE_2D, ambient_fbo.texture);
        gl.uniform1i(tAmbient_loc, 2);

        gl.uniform1i(tSatellite_loc, 0);

        gl.uniform2fv(resolution_loc, window.resolution);
        gl.uniform1f(softShadowScale_loc, softShadowScale);
        gl.uniform1f(ambientScale_loc, ambientScale);

        gl.enableVertexAttribArray(position_loc);
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer)
        gl.vertexAttribPointer(position_loc, 2, gl.FLOAT, false, 0, 0);
    }


    {
        var final_fbo = initFramebuffer(gl, 7);

        gl.bindFramebuffer(gl.FRAMEBUFFER, final_fbo);
        //gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.drawArrays(gl.TRIANGLES, 0, 3 * 2);
        //checkFrameBufferData(gl);
        return final_fbo;
    }
}

function init(gl, terrain_img, satellite_img, 
    tlong0, tlong1, tlat0, tlat1, zoom, 
    _sunPos, _softShadowScale, _ambientScale, _elevationScale, _segment_factor) {
    sunPos = eval(_sunPos);
    softShadowScale = eval(_softShadowScale);
    ambientScale = eval(_ambientScale);
    elevationScale = eval(_elevationScale);
    var segment_factor = eval(_segment_factor)

    window.img_width = terrain_img.width;
    window.img_height = terrain_img.height;
    window.resolution = [window.img_width, window.img_height];
    center = [(lower_left[0] + upper_right[0]) / 2, (lower_left[1] + upper_right[1]) / 2]
    lower_left[0] = tile2long(tlong0, zoom)
    upper_right[0] = tile2long(tlong1 + 1, zoom)
    lower_left[1] = tile2lat(tlat0 + 1, zoom)
    upper_right[1] = tile2lat(tlat1, zoom)
    radius = Math.cos(radians(center[1])) * 6371000
    pixelScale = radius * radians(upper_right[0] - lower_left[0]) / window.img_width;
    console.log("render params: ", 
    "tlong0: ", tlong0, 
    "tlong1: ", tlong1, 
    "tlat0: ", tlat0, 
    "tlat1: ", tlat1, 
    "zoom: ", zoom)


    gl.viewport(0, 0, window.img_width, window.img_height)
    console.log("terrain")
    var terrain_fbo = processTerrain(gl, terrain_img)
    //createImageFromTexture(gl, terrain_fbo, window.img_width, window.img_height)
    var terrain_pixels = new Float32Array(window.img_width * window.img_height * 4);
    gl.readPixels(0, 0, window.img_width, window.img_height, gl.RGBA, gl.FLOAT, terrain_pixels);

    console.log("normal")
    var normal_fbo = processNormal(gl, terrain_fbo)

    console.log("soft shadow")
    var softshadow_vert_source = `
    precision highp float;
    attribute vec2 position;

    void main() {
      gl_Position = vec4(position, 0, 1);
    }
    `
    var softshadow_frag_source = `
    precision highp float;

    uniform sampler2D tElevation;
    uniform sampler2D tNormal;
    uniform sampler2D tSrc;
    uniform vec3 sunDirection;
    uniform vec2 resolution;
    uniform float pixelScale;

    void main() {
      vec2 ires = 1.0 / resolution;
      vec3 src = texture2D(tSrc, gl_FragCoord.xy * ires).rgb;
      vec4 e0 = texture2D(tElevation, gl_FragCoord.xy * ires);
      vec3 n0 = texture2D(tNormal, gl_FragCoord.xy * ires).rgb;
      vec2 sr = normalize(sunDirection.xy);
      vec2 p0 = gl_FragCoord.xy;
      vec2 p = floor(p0);
      vec2 stp = sign(sr);
      vec2 tMax = step(0.0, sr) * (1.0 - fract(p0)) + (1.0 - step(0.0, sr)) * fract(p0);
      tMax /= abs(sr);
      vec2 tDelta = 1.0 / abs(sr);
      for (int i = 0; i < 65536; i++) {
        if (tMax.x < tMax.y) {
          tMax.x += tDelta.x;
          p.x += stp.x;
        } else {
          tMax.y += tDelta.y;
          p.y += stp.y;
        }
        vec2 ptex = ires * (p + 0.5);
        if (ptex.x < 0.0 || ptex.x > 1.0 || ptex.y < 0.0 || ptex.y > 1.0) {
          gl_FragColor = vec4(src + vec3(1.0/16.0) * clamp(dot(n0, sunDirection), 0.0, 1.0), 1.0);
          return;
        }
        vec4 e = texture2D(tElevation, ptex);
        float t = distance(p + 0.5, p0);
        float z = e0.r + t * pixelScale * sunDirection.z;
        if (e.r > z) {
          gl_FragColor = vec4(src, 1.0);
          return;
        }
      }
      gl_FragColor = vec4(src + vec3(1.0/16.0) * clamp(dot(n0, sunDirection), 0.0, 1.0), 1.0);


      //gl_FragColor = e0;
      //gl_FragColor = vec4(1, 0, 0, 1);
    }
    `
    var softshadowShader = createProgram(gl, [softshadow_vert_source, softshadow_frag_source]);
    var shadowPP = PingPong(gl, 3, 4);
    for (var i = 0; i < 16; i++) {
        var sunDirection = vec3.normalize(
            [],
            vec3.add(
                [],
                vec3.scale([], vec3.normalize([], sunPos), 149600000000),
                vec3.random([], 695508000 * sunRadiusScale)
            )
        )
        var tSrc = shadowPP.ping();
        var dest = shadowPP.pong();
        var src_id = shadowPP.getPingId();
        processSoftShadow(softshadowShader, gl, sunDirection, src_id, tSrc, dest, terrain_fbo, normal_fbo)
        shadowPP.swap();
    }
    var shadow_fbo = shadowPP.ping();

    gl.deleteTexture(shadowPP.pong().texture);
    gl.deleteFramebuffer(shadowPP.pong());

    var ambient_vert_source = `
    precision highp float;
    attribute vec2 position;

    void main() {
      gl_Position = vec4(position, 0, 1);
    }
    `
    var ambient_frag_source = `
    precision highp float;

    uniform sampler2D tElevation;
    uniform sampler2D tNormal;
    uniform sampler2D tSrc;
    uniform vec3 direction;
    uniform vec2 resolution;
    uniform float pixelScale;

    void main() {
      vec2 ires = 1.0 / resolution;
      vec3 src = texture2D(tSrc, gl_FragCoord.xy * ires).rgb;
      vec4 e0 = texture2D(tElevation, gl_FragCoord.xy * ires);
      vec3 n0 = texture2D(tNormal, gl_FragCoord.xy * ires).rgb;
      vec3 sr3d = normalize(n0 + direction);
      vec2 sr = normalize(sr3d.xy);
      vec2 p0 = gl_FragCoord.xy;
      vec2 p = floor(p0);
      vec2 stp = sign(sr);
      vec2 tMax = step(0.0, sr) * (1.0 - fract(p0)) + (1.0 - step(0.0, sr)) * fract(p0);
      tMax /= abs(sr);
      vec2 tDelta = 1.0 / abs(sr);
      for (int i = 0; i < 65536; i++) {
        if (tMax.x < tMax.y) {
          tMax.x += tDelta.x;
          p.x += stp.x;
        } else {
          tMax.y += tDelta.y;
          p.y += stp.y;
        }
        vec2 ptex = ires * (p + 0.5);
        if (ptex.x < 0.0 || ptex.x > 1.0 || ptex.y < 0.0 || ptex.y > 1.0) {
          gl_FragColor = vec4(src + vec3(1.0/16.0), 1.0);
          return;
        }
        vec4 e = texture2D(tElevation, ptex);
        float t = distance(p + 0.5, p0);
        float z = e0.r + t * pixelScale * sr3d.z;
        if (e.r > z) {
          gl_FragColor = vec4(src, 1.0);
          return;
        }
      }
      gl_FragColor = vec4(src + vec3(1.0/16.0), 1.0);
    }
    `
    var ambientShader = createProgram(gl, [ambient_vert_source, ambient_frag_source]);    
    var ambientPP = PingPong(gl, 5, 6)
    for (let i = 0; i < 16; i++) {
        console.log("ambient")
        var direction = vec3.random([], Math.random())
        let src = ambientPP.ping();
        let dest = ambientPP.pong();
        let src_id = shadowPP.getPingId();

        //if (i == 16) processAmbient(gl, direction, src_id, src, null, terrain_fbo, normal_fbo);else

        processAmbient(ambientShader, gl, direction, src_id, src, dest, terrain_fbo, normal_fbo);
        ambientPP.swap();
    }
    var ambient_fbo = ambientPP.ping();

    gl.deleteTexture(terrain_fbo.texture)
    gl.deleteFramebuffer(terrain_fbo)

    gl.deleteTexture(normal_fbo.texture)
    gl.deleteFramebuffer(normal_fbo)

    gl.deleteTexture(ambientPP.pong().texture);
    gl.deleteFramebuffer(ambientPP.pong());

    console.log("final")
    var final_fbo = processSatellite(gl, satellite_img, shadow_fbo, ambient_fbo)
    console.log("final complete")



    gl.deleteTexture(ambientPP.ping().texture);
    gl.deleteFramebuffer(ambientPP.ping());

    gl.deleteTexture(shadowPP.ping().texture);
    gl.deleteFramebuffer(shadowPP.ping());
    //console.time()
    /*window.img_width = parseInt(window.img_width / 2)
    window.img_height = parseInt(window.img_height / 2)*/
    var dx = (upper_right[0] - lower_left[0]) / window.img_width;
    var dy = (upper_right[1] - lower_left[1]) / window.img_height;
    var { positions, uvs, indices } = genTerrain(window.img_width, window.img_height,
        dx,
        dy,
        lower_left[0],
        lower_left[1],
        segment_factor);
    //console.log(positions)
    //    console.timeEnd()
    /*window.img_width = parseInt(window.img_width * 2)
    window.img_height = parseInt(window.img_height * 2)*/
    const vertices = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
        var terrain_j = Math.floor((positions[i] - lower_left[0]) / dx)
        var terrain_i = Math.floor((positions[i+1] - lower_left[1]) / dy)
        const mer_pos = mapboxgl.MercatorCoordinate.fromLngLat({
            lng: positions[i],
            lat: positions[i + 1]
        }, terrain_pixels[(terrain_i * window.img_width + terrain_j) * 4] * elevationScale)
        vertices[i] = mer_pos.x;
        vertices[i + 1] = mer_pos.y;
        vertices[i + 2] = mer_pos.z;
    }
    return { final_fbo, vertices, uvs, indices }
}

export {
    init,
    createProgram,
}