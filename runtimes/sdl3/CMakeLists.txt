# SPDX-License-Identifier: MIT OR Apache-2.0
# Rigby2D for SDL3. Builds the `rigby2d_sdl` library (the C++ animation runtime from
# runtimes/defold/rigby2d plus the SDL3 layer) and, with RIGBY_SDL_EXAMPLE, a small player.
#
#   cmake -S runtimes/sdl3 -B build -DCMAKE_PREFIX_PATH=<SDL3 install>
#   cmake --build build
#
# In your own project: add_subdirectory(path/to/rigby2d-sdl3) and link rigby2d_sdl.

cmake_minimum_required(VERSION 3.16)
project(rigby2d_sdl CXX)

option(RIGBY_SDL_IMAGE "Load atlas pages with SDL3_image (SDL 3.4 loads PNG without it)" ON)
option(RIGBY_SDL_EXAMPLE "Build the example player" ON)

find_package(SDL3 REQUIRED CONFIG)

# The runtime core: next to this folder in the repository, or in core/ in the release zip.
if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/core/include/rigby.h)
  set(RIGBY_CORE ${CMAKE_CURRENT_SOURCE_DIR}/core)
else()
  set(RIGBY_CORE ${CMAKE_CURRENT_SOURCE_DIR}/../defold/rigby2d)
endif()
file(GLOB RIGBY_CORE_SOURCES ${RIGBY_CORE}/commonsrc/rigby_*.cpp)

add_library(rigby2d_sdl ${RIGBY_CORE_SOURCES} src/rigby_sdl.cpp)
target_compile_features(rigby2d_sdl PUBLIC cxx_std_17)
target_include_directories(rigby2d_sdl PUBLIC include ${RIGBY_CORE}/include)
target_link_libraries(rigby2d_sdl PUBLIC SDL3::SDL3)

if(RIGBY_SDL_IMAGE)
  find_package(SDL3_image CONFIG)
  if(SDL3_image_FOUND)
    target_compile_definitions(rigby2d_sdl PRIVATE RIGBY_SDL_IMAGE)
    target_link_libraries(rigby2d_sdl PUBLIC SDL3_image::SDL3_image)
  else()
    message(STATUS "SDL3_image not found: SDL 3.4 loads PNG pages itself; on SDL 3.2 pass your own TextureLoader or use BMP pages")
  endif()
endif()

if(RIGBY_SDL_EXAMPLE)
  add_executable(rigby2d_sdl_player example/main.cpp)
  target_link_libraries(rigby2d_sdl_player PRIVATE rigby2d_sdl)
endif()
