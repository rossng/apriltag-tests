cmake_minimum_required(VERSION 3.15)
project(apriltags-kaess-detector)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(OpenCV REQUIRED)
find_package(Eigen3 REQUIRED)

# Find apriltags-kaess library
find_path(APRILTAGS_INCLUDE_DIR AprilTags/TagDetector.h)
find_library(APRILTAGS_LIBRARY apriltags)

if(NOT APRILTAGS_INCLUDE_DIR OR NOT APRILTAGS_LIBRARY)
    message(FATAL_ERROR "Could not find apriltags library")
endif()

add_executable(detector detector.cpp)

target_include_directories(detector PRIVATE ${APRILTAGS_INCLUDE_DIR} ${OpenCV_INCLUDE_DIRS} ${EIGEN3_INCLUDE_DIR})
target_link_libraries(detector ${APRILTAGS_LIBRARY} ${OpenCV_LIBS})

install(TARGETS detector DESTINATION bin)
