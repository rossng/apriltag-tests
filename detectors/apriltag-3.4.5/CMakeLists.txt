cmake_minimum_required(VERSION 3.15)
project(apriltag-detector)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(apriltag REQUIRED)

add_executable(detector detector.cpp)

target_link_libraries(detector apriltag)

install(TARGETS detector DESTINATION bin)
